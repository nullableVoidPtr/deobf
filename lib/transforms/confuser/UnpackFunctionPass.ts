import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { parse } from '@babel/parser';

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

				const innerFuncBody = parse(
					innerFuncSource.node.value,
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
						const bodyStmt = newInnerFunc.get('body').get('body')[0];
						const paramDecl = t.variableDeclarator(
							param,
							arg?.node ?? null,
						);
						if (!lastParamDecl) {
							const [decn] = bodyStmt.insertBefore(
								t.variableDeclaration(
									'var',
									[paramDecl],
								)
							);

							lastParamDecl = decn.get('declarations')[0];
						} else {
							lastParamDecl.insertAfter([
								paramDecl
							]);
						}

						newInnerFunc.get('params')[0].remove();
						arg?.remove();
						changed = true;
					}
				}

				if (call.node.arguments.length === 0 && newInnerFunc.node.params.length === 0 && newInnerFunc.node.body.directives.length === 0) {
					const state = { hasEarlyReturn: false };
					newInnerFunc.traverse({
						Function(func) {
							func.skip();
						},
						ReturnStatement(stmt) {
							if (stmt.getFunctionParent() === newInnerFunc) {
								this.hasEarlyReturn = true;
								path.stop();
							}
						}
					}, state);

					if (!state.hasEarlyReturn) {
						const stmt = call.parentPath;
						if (stmt.isExpressionStatement()) {
							stmt.replaceWithMultiple(newInnerFunc.get('body').node.body);
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