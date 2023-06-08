import * as t from '@babel/types';
import { Binding, NodePath, Scope } from '@babel/traverse';
import { dereferencePathFromBinding, inlineProxyCall } from '../../utils.js';
import LiteralFoldPass from '../LiteralFoldPass.js';
import DeadCodeRemovalPass from './DeadCodeRemovalPass.js';

export default (path: NodePath): boolean => {
	let changed = false;
	const state = {
		parentScopes: new Map<Scope, {
				binding: Binding;
				propertyMap: Map<
					string,
					NodePath<t.Expression | t.Function>
				>;
				mutated: boolean;
		}[]>(),
	};

	path.traverse({
		VariableDeclarator: {
			enter (path) {
				const objExpPath = path.get('init');
				if (!objExpPath.isObjectExpression()) return;

				const id = path.get('id');
				if (!id.isIdentifier()) return;

				path.scope.crawl();
				const binding = path.scope.getBinding(id.node.name);
				if (!binding) return;

				if (!binding.constant) {
					if (binding.constantViolations.length !== 1) return;
					if (binding.constantViolations[0] != binding.path) return;
					if (binding.kind != 'var') return;
				}

				if (binding.referencePaths.some(p => objExpPath.isAncestor(p))) {
					return;
				}

				const properties = objExpPath.get('properties');
				if (properties.length === 0) return;

				const propertyMap = new Map<
					string,
					NodePath<t.Expression | t.Function>
				>();

				for (const property of properties) {
					if (!property.isObjectMember()) return;

					let key;
					const keyPath = property.get('key');
					if (keyPath.isStringLiteral()) {
						key = keyPath.node.value;
					} else if (keyPath.isIdentifier()) {
						key = keyPath.node.name;
					} else {
						return;
					}

					if (property.isObjectMethod()) {
						propertyMap.set(key, property);
					} else {
						const valuePath = property.get('value') as NodePath;
						if (!valuePath.isExpression()) return;
						propertyMap.set(key, valuePath);
					}
				}

				let mutated = false;
				const unreplacedReferences = [];
				for (const reference of [...binding.referencePaths].reverse()) {
					const { parentPath } = reference;
					if (!parentPath || parentPath.find(p => p.removed)) {
						continue;
					}

					if (!parentPath?.isMemberExpression()) {
						unreplacedReferences.push(reference);
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
						unreplacedReferences.push(reference);
						continue;
					}
					
					const valuePath = propertyMap.get(key);
					if (!valuePath) {
						unreplacedReferences.push(reference);
						continue;
					}

					if (!valuePath.isFunction()) {
						parentPath.replaceWith(valuePath);
					} else {
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
					}

					changed = true;
					mutated = true;
					dereferencePathFromBinding(binding, reference);
				}

				LiteralFoldPass(path.scope.path);
				DeadCodeRemovalPass(path.scope.path);
				// ObjectFoldPass(path.scope.path);

				path.scope.crawl();

				const storage = {
					binding,
					propertyMap,
					mutated,
				};

				let scopeInfo = this.parentScopes.get(path.scope);
				if (!scopeInfo) {
					scopeInfo = [];
					this.parentScopes.set(path.scope, scopeInfo);
				}
				scopeInfo.push(storage);
			},
		},
		Scopable: {
			exit(path) {
				const storages = this.parentScopes.get(path.scope);
				if (!storages) return;
			
				for (const { binding, propertyMap, mutated } of storages) {
					if (!mutated) {
						const { parentPath } = binding.path;
						if (!parentPath?.isVariableDeclaration()) continue;
						if (parentPath.node.kind !== 'const') continue;
						if (![...propertyMap.keys()].every((k => k.match(/^\w{5}$/)))) continue;
					}

					if (binding.referencePaths.filter(r => r.find(p => p.removed || !p.hasNode()) === null).length === 0) {
						binding.path.remove();
						binding.scope.removeBinding(binding.identifier.name);
					}
				}

				this.parentScopes.delete(path.scope);
				path.scope.crawl();
			},
		},
	}, state);

	return changed;
};
