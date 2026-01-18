import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { dereferencePathFromBinding, pathAsBinding } from '../../utils.js';

export const repeatUntilStable = true;

export default (path: NodePath): boolean => {
	let folded = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		VariableDeclarator(path) {
			const stmt = path.findParent(p => p.isStatement());
			if (!stmt) return;

			const init = path.get('init');
			if (!init.isObjectExpression()) return;

			const binding = pathAsBinding(path);
			if (!binding) return;

			const uncertainReferences: NodePath[] = [];
			for (const reference of binding.referencePaths) {
				const refStmt = reference.findParent(p => p.isStatement());
				if (!refStmt) continue;
				if (refStmt.parentPath == stmt.parentPath) continue;

				uncertainReferences.push(reference);
			}

			if (uncertainReferences.length === 1) {
				// disgusting hack to account refs within dead code
				const reference = uncertainReferences[0];
				const ifStmt = reference.findParent(p => p.isIfStatement());
				if (!ifStmt) return;
			} else {
				for (const reference of uncertainReferences) {
					if (binding.referencePaths.some(
						other => other != reference &&
						other.findParent(p => p.isStatement())?.isAncestor(reference))
					) continue;

					return;
				}
			}

			for (const reference of [...binding.referencePaths]) {
				if (uncertainReferences.includes(reference)) continue;

				const ancestry = reference.getAncestry();
				const keys: NodePath<t.Expression | t.PrivateName>[] = [];
				let i = 1;
				for (; i < ancestry.length; i++) {
					const current = ancestry[i];
					if (!current.isMemberExpression()) break;

					if (current.key != 'object') {
						if (!current.parentPath?.isAssignmentExpression()) break;
						if (current.key != 'left') break;
					}

					keys.push(current.get('property'));
				}

				const finalKey = keys.at(-1);
				if (!finalKey) continue;

				if (i == ancestry.length) continue;

				const assignment = ancestry[i];
				if (!assignment.isAssignmentExpression()) continue;

				let currentObject = init.node;
				let canFold = true;
				for (const key of keys.slice(0, keys.length - 1)) {
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
						canFold = false;
						break;
					}

					if (!t.isObjectExpression(next.value)) {
						canFold = false;
						break;
					}

					currentObject = next.value;
				}
				if (canFold) {
					const computed = !(finalKey.isPrivateName() || finalKey.isIdentifier());
					currentObject.properties.push(
						t.objectProperty(
							finalKey.node,
							assignment.node.right,
							computed,
						)
					);
					assignment.remove();

					dereferencePathFromBinding(binding, reference);
					folded = true;
				}
			}

			if (binding.referencePaths.filter(p => !uncertainReferences.includes(p)).length === 1) {
				const reference = binding.referencePaths[0];
				const { parentPath } = reference;
				if ((parentPath?.isVariableDeclarator() && reference.key == 'init')
				|| (parentPath?.isAssignmentExpression() && reference.key == 'right')) {
					path.remove();
					binding.scope.removeBinding(binding.identifier.name);
					reference.replaceWith(init.node);
					folded = true;
				}
			}
		},
	});

	logger.info('Done' + (folded ? ' with changes' : ''));

	return folded;
};
