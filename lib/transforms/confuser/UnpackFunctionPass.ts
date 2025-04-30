import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { parse } from '@babel/parser';
import { asSingleStatement, getPropertyName } from '../../utils.js';
import { crawlProperties } from '../../ObjectBinding.js';

function extractGlobalsObject(obj: NodePath<t.ObjectExpression>): {
	globals: Record<string, string>;
	typeofs: Record<string, string>;
} | null {
	const globals: Record<string, string> = {};
	const typeofs: Record<string, string> = {};
	for (const property of obj.get('properties')) {
		if (!property.isObjectMethod()) return null;

		if (property.node.kind === 'method') return null;

		const key = getPropertyName(property);
		if (!key) return null;

		const stmt = asSingleStatement(property.get('body'));
		
		if (property.node.kind === 'get') {
			if (!stmt?.isReturnStatement()) return null;

			const argument = stmt.get('argument');
			if (!argument.hasNode()) return null;

			if (argument.isIdentifier()) {
				if (globals[key] != null && globals[key] !== argument.node.name) return null
				globals[key] = argument.node.name;
			} else {
				if (!argument.isUnaryExpression({ operator: 'typeof', prefix: true })) return null;

				const id = argument.get('argument');
				if (!id.isIdentifier()) return null;

				typeofs[key] = id.node.name;
			}
		} else {
			let assign: NodePath<t.Node | null | undefined> | null = null;
			if (stmt?.isReturnStatement()) {
				assign = stmt.get('argument');
			} else if (stmt?.isExpressionStatement()) {
				assign = stmt.get('expression');
			}

			if (!assign?.isAssignmentExpression({ operator: '=' })) return null;

			const target = assign.get('left');
			if (!target.isIdentifier()) return null;

			if (globals[key] != null && globals[key] !== target.node.name) return null
			globals[key] = target.node.name;
		}
	}

	return { globals, typeofs };
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		CallExpression(call) {
			const innerFunc = call.get('callee');
			if (!innerFunc.isCallExpression()) return;
			if (!innerFunc.get('callee').isIdentifier({ name: 'Function'})) return;
			const innerFuncSpec = innerFunc.get('arguments');
			try {
				const innerFuncParams = innerFuncSpec.slice(0, -1).map(p => {
					if (!p.isStringLiteral()) throw new Error('unexpected arg name');

					return t.identifier(p.node.value);
				});
				const innerFuncSource = innerFuncSpec.at(-1);
				if (!innerFuncSource?.isStringLiteral()) return;

				const code = innerFuncSource.node.value;

				const innerFuncBody = parse(
					code,
					{
						sourceType: 'script',
						allowAwaitOutsideFunction: true,
						allowNewTargetOutsideFunction: true,
						allowReturnOutsideFunction: true,
					},
				).program;

				const [newInnerFunc] = innerFunc.replaceWith(
					t.functionExpression(
						null,
						innerFuncParams,
						t.blockStatement(
							innerFuncBody.body,
							innerFuncBody.directives,
						),
					)
				);

				newInnerFunc.hub = {
					getCode: () => code,
					getScope: () => newInnerFunc.scope,
					buildError: () => { throw new Error() },
					addHelper: () => { throw new Error() },
				}

				changed = true;

				const outerArgs = call.get('arguments');
				let lastParamDecl: NodePath<t.VariableDeclarator> | null = null;
				for (let i = 0; i < innerFuncParams.length; i++) {
					const arg = outerArgs.at(i);

					const param = innerFuncParams[i];
					const binding = newInnerFunc.scope.getBinding(param.name);
					if (!binding?.constant) break;
					
					if (arg?.isLiteral()) {
						for (const ref of binding.referencePaths) {
							ref.replaceWith(arg);
							changed = true;
						}
					} else if (arg?.isExpression() || !arg) {
						if (arg?.isObjectExpression()) {
							const globalObject = extractGlobalsObject(arg);
							if (globalObject) {
								const obj = crawlProperties(binding);
								if (obj.objectReferences.size === 0 && obj.unresolvedBindings.size === 0 && obj.unresolvedReferences.size === 0) {
									for (const [key, propertyBinding] of obj.properties.entries()) {
										const globalName = globalObject.globals[key];
										if (globalName) {
											for (const ref of propertyBinding.referencePaths) {
												ref.replaceWith(t.identifier(globalName));
											}
										} else {
											const typeofName = globalObject.typeofs[key];
											if (!typeofName) throw new Error();

											for (const ref of propertyBinding.referencePaths) {
												ref.replaceWith(t.unaryExpression(
													'typeof',
													t.identifier(typeofName),
													true,
												));
											}
										}
									}

									newInnerFunc.get('params.0').remove();
									arg.remove();
									changed = true;
									continue;
								}
							}
						}

						const paramDecl = t.variableDeclarator(
							param,
							arg?.node ?? null,
						);
						if (!lastParamDecl) {
							const [decn] = newInnerFunc.get('body').unshiftContainer(
								'body',
								t.variableDeclaration(
									'var',
									[paramDecl],
								)
							);

							lastParamDecl = decn.get('declarations.0');
						} else {
							lastParamDecl.insertAfter([
								paramDecl
							]);
						}

						newInnerFunc.get('params.0').remove();
						arg?.remove();
						changed = true;
					}
				}

				if (call.node.arguments.length === 0 && newInnerFunc.node.params.length === 0 && newInnerFunc.node.body.directives.length === 0) {
					const state: {
						hasEarlyReturn: boolean;
						returnStmt: NodePath<t.ReturnStatement> | null
					} = { hasEarlyReturn: false, returnStmt: null };
					newInnerFunc.traverse({
						Function(func) {
							func.skip();
						},
						ReturnStatement(stmt) {
							if (stmt.getFunctionParent() === newInnerFunc) {
								if (typeof stmt.key === 'number' && Array.isArray(stmt.container) && stmt.key === stmt.container.length - 1) {
									this.returnStmt = stmt;
									return;
								}
								this.hasEarlyReturn = true;
								path.stop();
							}
						}
					}, state);

					if (!state.hasEarlyReturn) {
						const stmt = call.parentPath;
						if (stmt.isExpressionStatement()) {
							if (state.returnStmt) {
								const argument = state.returnStmt.get('argument');
								if (argument.isCallExpression() && argument.node.arguments.length === 0) {
									const innerFunc = argument.get('callee');
									if (innerFunc.isFunctionExpression() && innerFunc.node.params.length === 0 && innerFunc.node.body.directives.length === 0) {
										state.returnStmt.replaceWithMultiple(innerFunc.node.body.body);
									} else {
										state.returnStmt.replaceWith(argument.node);
									}
								} else if (argument.hasNode()) {
									state.returnStmt.replaceWith(argument.node);
								}
							}

							const newStmts = stmt.replaceWithMultiple(newInnerFunc.get('body').node.body);
							for (const stmt of newStmts) {
								stmt.hub = newInnerFunc.hub;
							}
						}
					}
				}

				call.scope.crawl();
			} catch {
				return;
			}
		}
	});

	return changed;
};