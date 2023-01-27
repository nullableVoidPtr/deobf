import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";
import { inlineProxyCall } from "../../utils.js";

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		VariableDeclarator(path) {
			const objExpPath = path.get("init");
			if (!objExpPath.isObjectExpression()) {
				return;
			}

			const id = path.get('id');
			if (!id.isIdentifier()) {
				return;
			}

			const binding = path.scope.getBinding(id.node.name);
			if (binding == null) {
				return;
			}

			if (!binding.constant) {
				if (binding.constantViolations.length !== 1) return;
				if (binding.constantViolations[0] != binding.path) return;
				if (binding.kind != "var") return;
			}

			if (binding.referencePaths.some(p => objExpPath.isAncestor(p))) {
				return;
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
				return;
			}

			let mutated = false;
			let allRemoved = true;
			for (const reference of [...binding.referencePaths].reverse()) {
				const { parentPath } = reference;
				if (parentPath == null || parentPath.find(p => p.removed)) {
					continue;
				}

				if (!parentPath?.isMemberExpression()) {
					allRemoved = false;
					continue;
				}

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

				mutated = true;

				const refIndex = binding.referencePaths.indexOf(reference);
				if (refIndex !== -1) {
					binding.referencePaths.splice(refIndex, 1);
					binding.dereference();
				}
			}

			if (mutated && allRemoved) {
				binding.path.remove();
				binding.scope.removeBinding(binding.identifier.name);
			}

			path.scope.crawl();
		},
	});

	return changed;
};
