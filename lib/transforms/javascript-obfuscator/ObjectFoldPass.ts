import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";


export const repeatUntilStable = true;

export default (path: NodePath): boolean => {
	let folded = false;
	path.traverse({
		Scopable(path) {
			for (const binding of Object.values(path.scope.bindings)) {
				const { path } = binding;
				if (!path.isVariableDeclarator()) {
					continue;
				}

				const init = path.get("init");
				if (!init.isObjectExpression()) {
					continue;
				}
				for (const reference of binding.referencePaths) {
					const ancestry = reference.getAncestry();
					const keys: NodePath<t.Expression | t.PrivateName>[] = [];
					let i = 1;
					for (; i < ancestry.length; i++) {
						const current = ancestry[i];
						if (!current.isMemberExpression()) {
							break;
						}

						if (current.key != "object") {
							if (
								!current.parentPath.isAssignmentExpression() ||
								current.key != "left"
							) {
								break;
							}
						}

						keys.push(current.get("property"));
					}

					if (i == ancestry.length) {
						continue;
					}

					const assignment = ancestry[i];
					if (!assignment.isAssignmentExpression()) {
						continue;
					}

					let currentObject = init.node;
					let canFold = true;
					while (keys.length > 1) {
						const key = keys.shift()!;
						const next = <t.ObjectProperty>(
							currentObject.properties.find((p) => {
								if (!t.isObjectProperty(p)) {
									return false;
								}
								if (
									t.isPrivateName(p.key) &&
									key.isPrivateName()
								) {
									return p.key.id.name == key.node.id.name;
								}
								if (
									t.isIdentifier(p.key) &&
									key.isIdentifier()
								) {
									return p.key.name == key.node.name;
								}
								if (key.isStringLiteral()) {
									if (t.isStringLiteral(p.key)) {
										return p.key.value == key.node.value;
									}
									if (
										t.isNumericLiteral(p.key) &&
										Number.isInteger(key.node.value)
									) {
										return (
											p.key.value ==
											parseInt(key.node.value)
										);
									}
								}
								if (key.isNumericLiteral()) {
									if (t.isNumericLiteral(p.key)) {
										return p.key.value == key.node.value;
									}
									if (
										t.isStringLiteral(p.key) &&
										Number.isInteger(key.node.value)
									) {
										return (
											p.key.value ==
											key.node.value.toString()
										);
									}
								}

								return false;
							})
						);
						if (next == null) {
							throw new Error("unexpected key type");
						}

						if (!t.isObjectExpression(next.value)) {
							canFold = false;
							break;
						}

						currentObject = next.value;
					}
					if (canFold) {
						currentObject.properties.push(
							t.objectProperty(
								keys[0].node,
								assignment.node.right
							)
						);
						assignment.remove();
					}
				}
			}
		},
	});

	return folded;
};
