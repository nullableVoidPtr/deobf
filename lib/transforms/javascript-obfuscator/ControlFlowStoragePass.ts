import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";
import { inlineProxyCall } from "../../utils.js";

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		Scopable(path: NodePath<t.Scopable>) {
			const { scope } = path;
			for (const binding of Object.values(scope.bindings)) {
				if (!binding.path.isVariableDeclarator()) {
					continue;
				}

				const objExpPath = binding.path.get("init");
				if (!objExpPath.isObjectExpression()) {
					continue;
				}

				if (!binding.constant) {
					if (binding.constantViolations.length !== 1) continue;
					if (binding.constantViolations[0] != binding.path) continue;
					if (binding.kind != "var") continue;
				}

				const properties = objExpPath.get("properties");
				const propertyMap = new Map<
					string,
					NodePath<t.Expression | t.Function>
				>();
				let invalidProperty = false;
				for (const property of properties) {
					let key;
					if (
						property.isObjectProperty() ||
						property.isObjectMethod()
					) {
						const keyPath = property.get("key") as NodePath;
						if (keyPath.isStringLiteral()) {
							key = keyPath.node.value;
						} else if (keyPath.isIdentifier()) {
							key = keyPath.node.name;
						} else {
							invalidProperty = true;
							break;
						}
						if (property.isObjectMethod()) {
							propertyMap.set(key, property);
						} else {
							const valuePath = property.get("value");
							if (!valuePath.isExpression()) {
								invalidProperty = true;
								break;
							}
							propertyMap.set(key, valuePath);
						}
					} else {
						invalidProperty = true;
						break;
					}
				}
				if (invalidProperty) {
					continue;
				}
				let allRemoved = true;
				for (const refPath of binding.referencePaths) {
					const { parentPath } = refPath;
					if (parentPath?.isMemberExpression()) {
						const propertyPath = parentPath.get("property");
						let key;
						if (propertyPath.isStringLiteral()) {
							key = propertyPath.node.value;
						} else if (propertyPath.isIdentifier()) {
							key = propertyPath.node.name;
						}

						if (!key || !propertyMap.has(key)) {
							allRemoved = false;
							continue;
						}

						const valuePath = propertyMap.get(key)!;
						if (valuePath?.isFunction()) {
							const callPath = parentPath.parentPath;
							if (!callPath?.isCallExpression()) {
								throw new Error("unexpected call expression");
							}

							const args = callPath.node.arguments;
							if (
								!args.every((a): a is t.Expression =>
									t.isExpression(a)
								)
							) {
								throw new Error("unexpected call args");
							}

							inlineProxyCall(callPath, valuePath, args);
						} else {
							parentPath.replaceWith(valuePath);
						}
					} else {
						allRemoved = false;
					}
				}

				if (allRemoved) {
					binding.path.remove();
				}
			}

			path.scope.crawl();
		},
	});

	return changed;
};
