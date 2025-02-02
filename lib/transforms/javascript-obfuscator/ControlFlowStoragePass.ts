import * as t from '@babel/types';
import { type Binding, type NodePath, type Scope } from '@babel/traverse';
import { inlineProxyCall, pathAsBinding } from '../../utils.js';
import LiteralFoldPass from '../LiteralFoldPass.js';
import DeadCodeRemovalPass from './DeadCodeRemovalPass.js';
import { crawlProperties, PropertyBinding } from '../../ObjectBinding.js';

export const repeatUntilStable = true;

export default (path: NodePath): boolean => {
	let changed = false;
	const state = {
		parentScopes: new Map<Scope, {
				binding: Binding;
				propertyMap: Map<
					PropertyBinding,
					NodePath<t.Expression | t.Function>
				>;
				mutated: boolean;
		}[]>(),
	};

	path.traverse({
		VariableDeclarator: {
			enter(path) {
				const objExpPath = path.get('init');
				if (!objExpPath.isObjectExpression()) return;

				const binding = pathAsBinding(path);
				if (!binding) return;

				if (binding.referencePaths.some(p => objExpPath.isAncestor(p))) return;

				if (objExpPath.node.properties.length === 0) return;

				const {
					properties,
					unresolvedBindings,
					// unresolvedReferences,
				} = crawlProperties(binding);

				if (properties.size === 0) return;

				if (unresolvedBindings.size > 0) return;

				const propertyMap = new Map<
					PropertyBinding,
					NodePath<t.Expression | t.Function>
				>();

				for (const property of properties.values()) {
					if (!property.constant) return;

					const { path } = property
					if (path?.isObjectMethod()) {
						propertyMap.set(property, path);
					} else if (path?.isObjectProperty()) {
						const valuePath = path.get('value');
						if (valuePath.isExpression() || valuePath.isFunction()) {
							propertyMap.set(property, valuePath);
						}
					} else {
						return;
					}

				}

				let mutated = false;

				const nestedReferences: {
					property: PropertyBinding;
					reference: NodePath;
					valuePath: NodePath<t.Function>;
				}[] = [];
				for (const [property, valuePath] of propertyMap.entries()) {
					if (valuePath.isFunction()) {
						// undo some overzealous deobfuscation
						undo: {
							const body = valuePath.get('body');
							if (!body.isBlockStatement()) break undo;

							const stmts = body.get('body');
							if (stmts.length !== 2) break undo;

							const [ifStmt, returnStmt] = stmts;
							if (!ifStmt.isIfStatement()) break undo;

							if (!returnStmt.isReturnStatement()) break undo;

							const returnArg = returnStmt.get('argument');
							if (!returnArg.isExpression()) break undo;

							const ifBody = ifStmt.get('consequent');
							if (!ifBody.isBlockStatement()) break undo;

							const ifTest = ifStmt.get('test');
							const ifBodyStmts = ifBody.get('body');
							if (ifBodyStmts.length !== 1) break undo;

							const [consequentReturn] = ifBodyStmts;
							if (!consequentReturn.isReturnStatement()) break undo;

							const consequentReturnArg = consequentReturn.get('argument');
							if (!consequentReturnArg.isBooleanLiteral()) break undo;

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
					}

					if (valuePath.isFunction()) {
						for (const reference of property.referencePaths) {
							const callPath = reference.parentPath;

							const state = { containsRef: false };
							callPath!.traverse({
								MemberExpression(memberExpr) {
									if (memberExpr === reference) {
										path.skip();
										return;
									}

									if (memberExpr.get('object').isIdentifier({ name: property.objectBinding.identifier.name })) {
										this.containsRef = true;
										path.stop();
									}
								}
							}, state);

							if (state.containsRef) {
								nestedReferences.push({
									property,
									reference,
									valuePath,
								});
								continue;
							}

							if (!callPath?.isCallExpression() || reference.key !== 'callee') {
								throw new Error('unexpected call expression');
							}

							const args = callPath.get('arguments');
							if (
								!args.every((a): a is NodePath<t.Expression> => a.isExpression())
							) {
								throw new Error('unexpected call args');
							}

							inlineProxyCall(callPath, valuePath, args);

							mutated = true;
							property.dereference(reference);
						}
					} else {
						for (const reference of property.referencePaths) {
							reference.replaceWith(t.cloneNode(valuePath.node));

							mutated = true;
							property.dereference(reference);
						}
					}
				}

				nestedReferences.sort((a, b) =>
					a.reference.getAncestry().length - b.reference.getAncestry().length
				);

				for (const {property, reference, valuePath} of nestedReferences) {
					if (reference.find(p => p.removed)) continue;

					const callPath = reference.parentPath;
					if (!callPath?.isCallExpression() || reference.key !== 'callee') {
						throw new Error('unexpected call expression');
					}

					const args = callPath.get('arguments');
					if (
						!args.every((a): a is NodePath<t.Expression> => a.isExpression())
					) {
						throw new Error('unexpected call args');
					}

					try {
						inlineProxyCall(callPath, valuePath, args);
					} catch {
						continue;
					}

					mutated = true;
					property.dereference(reference);
				}

				LiteralFoldPass(path.scope.path);
				DeadCodeRemovalPass(path.scope.path);
				// ObjectFoldPass(path.scope.path);

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
					changed ||= mutated;

					if (!mutated) {
						const { parentPath } = binding.path;
						if (!parentPath?.isVariableDeclaration()) continue;
						if (parentPath.node.kind !== 'const') continue;
						if (![...propertyMap.keys()].every((k => typeof k.key === 'string' && k.key.match(/^\w{5}$/)))) continue;
					}

					if (binding.referencePaths.filter(r => r.find(p => p.removed || !p.hasNode()) === null).length === 0) {
						binding.path.remove();
						binding.scope.removeBinding(binding.identifier.name);
					}
				}

				this.parentScopes.delete(path.scope);
			},
		},
	}, state);

	return changed;
};
