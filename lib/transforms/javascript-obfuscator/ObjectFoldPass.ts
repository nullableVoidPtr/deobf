import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import { dereferencePathFromBinding } from '../../utils.js';


export const repeatUntilStable = true;

export default (path: NodePath): boolean => {
	const folded = false;
	path.traverse({
		VariableDeclarator(path) {
			const stmt = path.findParent(p => p.isStatement());
			if (!stmt) {
				return;
			}

			const init = path.get('init');
			if (!init.isObjectExpression()) {
				return;
			}

			const id = path.get('id');
			if (!id.isIdentifier()) {
				return;
			}

			const binding = path.scope.getBinding(id.node.name);
			if (!binding) {
				return;
			}

			const uncertainReferences = [];
			for (const reference of binding.referencePaths) {
				const refStmt = reference.findParent(p => p.isStatement());
				if (!refStmt || refStmt.parentPath == stmt.parentPath) {
					continue;
				}

				uncertainReferences.push(reference);
			}

			for (const reference of uncertainReferences) {
				if (binding.referencePaths.some(
					other => other != reference &&
					other.findParent(p => p.isStatement())?.isAncestor(reference))
				) {
					continue;
				}
				return;
			}

			for (const reference of [...binding.referencePaths]) {
				if (uncertainReferences.includes(reference)) {
					continue;
				}

				const ancestry = reference.getAncestry();
				const keys: NodePath<t.Expression | t.PrivateName>[] = [];
				let i = 1;
				for (; i < ancestry.length; i++) {
					const current = ancestry[i];
					if (!current.isMemberExpression()) {
						break;
					}

					if (current.key != 'object') {
						if (
							!current.parentPath?.isAssignmentExpression() ||
							current.key != 'left'
						) {
							break;
						}
					}

					keys.push(current.get('property'));
				}

				if (keys.length === 0) {
					continue;
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
				for (const key of keys.splice(0, keys.length - 1)) {
					const next = <t.ObjectProperty | undefined>(
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
					if (!next) {
						throw new Error('unexpected key type');
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

					dereferencePathFromBinding(binding, reference);
				}
			}

			if (binding.referencePaths.length === 1) {
				const reference = binding.referencePaths[0];
				const { parentPath } = reference;
				if ((parentPath?.isVariableDeclarator() && reference.key == 'init')
				|| (parentPath?.isAssignmentExpression() && reference.key == 'right')) {
					path.remove();
					binding.scope.removeBinding(binding.identifier.name);
					reference.replaceWith(init.node);
				}
			}
		},
	});

	return folded;
};
