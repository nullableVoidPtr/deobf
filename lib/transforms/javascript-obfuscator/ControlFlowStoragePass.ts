import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import { dereferencePathFromBinding, inlineProxyCall } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		VariableDeclarator(path) {
			const objExpPath = path.get('init');
			if (!objExpPath.isObjectExpression()) {
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

			if (!binding.constant) {
				if (binding.constantViolations.length !== 1) return;
				if (binding.constantViolations[0] != binding.path) return;
				if (binding.kind != 'var') return;
			}

			if (binding.referencePaths.some(p => objExpPath.isAncestor(p))) {
				return;
			}

			const properties = objExpPath.get('properties');
			const propertyMap = new Map<
				string,
				NodePath<t.Expression | t.Function>
			>();
			let invalidProperty = false;
			for (const property of properties) {
				let key;
				if (property.isObjectMember()) {
					const keyPath = property.get('key');
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
						const valuePath = property.get('value') as NodePath;
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
				if (!parentPath || parentPath.find(p => p.removed)) {
					continue;
				}

				if (!parentPath?.isMemberExpression()) {
					allRemoved = false;
					continue;
				}

				const propertyPath = parentPath.get('property');
				let key;
				if (propertyPath.isStringLiteral()) {
					key = propertyPath.node.value;
				} else if (propertyPath.isIdentifier()) {
					key = propertyPath.node.name;
				}

				if (!key) {
					allRemoved = false;
					continue;
				}
				
				const valuePath = propertyMap.get(key);
				if (!valuePath) {
					allRemoved = false;
					continue;
				}

				if (valuePath?.isFunction()) {
					const callPath = parentPath.parentPath;
					if (!callPath?.isCallExpression()) {
						throw new Error('unexpected call expression');
					}

					const args = callPath.node.arguments;
					if (
						!args.every((a): a is t.Expression =>
							t.isExpression(a)
						)
					) {
						throw new Error('unexpected call args');
					}

					// undo some overzealous deobfuscation
					undo: {
						const body = valuePath.get('body');
						if (!body.isBlockStatement()) {
							break undo;
						}
						const stmts = body.get('body');
						if (stmts.length !== 2) {
							break undo;
						}
						const [ifStmt, returnStmt] = stmts;
						if (!ifStmt.isIfStatement()) {
							break undo;
						}
						if (!returnStmt.isReturnStatement()) {
							break undo;
						}
						const returnArg = returnStmt.get('argument');
						if (!returnArg.isExpression()) {
							break undo;
						}
						
						const ifBody = ifStmt.get('consequent');
						if (!ifBody.isBlockStatement()) {
							break undo;
						}

						const ifTest = ifStmt.get('test');
						const ifBodyStmts = ifBody.get('body');
						if (ifBodyStmts.length !== 1) {
							break undo;
						}
						const [consequentReturn] = ifBodyStmts;
						if (!consequentReturn.isReturnStatement()) {
							break undo;
						}
						const consequentReturnArg = consequentReturn.get('argument');
						if (!consequentReturnArg.isBooleanLiteral()) {
							break undo;
						}
						
						if (consequentReturnArg.node.value) {
							ifStmt.remove();
							returnArg.replaceWith(t.logicalExpression('||', ifTest.node, returnArg.node));
						} else {
							let predicate = ifTest.node;
							if (t.isUnaryExpression(predicate, {operator: '!'})) {
								predicate = predicate.argument;
							} else {
								predicate = t.unaryExpression('!', predicate);
							}
							
							ifStmt.remove();
							returnArg.replaceWith(t.logicalExpression('&&', predicate, returnArg.node));
						}
					}

					try {
						inlineProxyCall(callPath, valuePath, args);
					} catch {
						continue;
					}
				} else {
					parentPath.replaceWith(valuePath);
				}

				changed = true;
				mutated = true;

				dereferencePathFromBinding(binding, reference);
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
