import { NodePath } from "@babel/traverse";
import * as bq from "babylon-query";
                
const innerFuncSelector = bq.parse(
    `FunctionExpression:has(VariableDeclarator
        > ConditionalExpression.init:has(
            > Identifier.test
        ):has(
            FunctionExpression.alternate
        )
        > FunctionExpression.consequent
        VariableDeclarator
        > CallExpression.init:has(
            > Identifier.arguments.0
        ):has(
            > Identifier.arguments.1[name='arguments']
        )
        > MemberExpression.callee:has(
            > Identifier.object
        )
        > Identifier.property[name='apply']
    )`
);

export default (path: NodePath): boolean => {
    let changed = false;

    path.traverse({
        Scopable(path) {
			for (const binding of Object.values(path.scope.bindings)) {
				const { path } = binding;
				if (!path.isVariableDeclarator()) {
					continue;
				}

				const callControllerInit = path.get("init");
				if (!callControllerInit.isCallExpression()) {
                    continue;
                }

                const callController = callControllerInit.get('callee');
                if (!callController.isFunctionExpression()) {
                    continue;
                }
                const body = callController.get('body').get('body');
                if (body.length !== 2) {
                    continue;
                }

                const [declarations, returnStmt] = body;
                if (!declarations.isVariableDeclaration()) {
                    continue;
                }
                if (!returnStmt.isReturnStatement()) {
                    continue;
                }

                const innerClosure = returnStmt.get('argument');
                if (!innerClosure.isFunctionExpression()) {
                    continue;
                }

                const params = innerClosure.get("params");
                if (params.length !== 2 || !params.every((p) => p.isIdentifier())) {
                    continue;
                }

                if (!bq.matches(innerClosure, innerFuncSelector, {})) {
                    continue;
                }

                const bindingRef = binding.referencePaths[0]

                const initCall = bindingRef.parentPath;
                if (initCall == null || !initCall.isCallExpression()) {
                    continue;
                }

                const wrappedUse = initCall.parentPath;
                if (wrappedUse?.isVariableDeclarator()) {
                    const wrappedAssignmentLeft = wrappedUse.get('id');
                    if (!wrappedAssignmentLeft.isIdentifier()) {
                        continue;
                    }
                    const wrappedId = wrappedAssignmentLeft.node.name;
                    
                    const wrappedBinding = wrappedUse.scope.getBinding(wrappedId);
                    if (wrappedBinding == null) {
                        continue;
                    }
                    for (const wrappedRef of wrappedBinding.referencePaths) {
                        if (wrappedRef.isDescendant(wrappedUse)) {
                            continue;
                        }
                        if (wrappedRef.parentPath?.isCallExpression()) {
                            wrappedRef.parentPath.remove();
                            changed = true;
                        }
                    }

                    wrappedBinding.path.remove();
                } else if (wrappedUse.isCallExpression()) {
                    const callStmt = wrappedUse.parentPath;
                    if (callStmt.isExpressionStatement()) {
                        callStmt.remove();
                        changed = true;
                    }
                }

                path.remove();
            }
        },
        FunctionDeclaration(path) {
            const body = path.get('body').get('body');
            if (body.length !== 2) {
                return;
            }

            const innerFunc = body[0];
            const matches = bq.query(
                innerFunc, 
                `ReturnStatement
                > CallExpression.argument:has(
                    > StringLiteral.arguments.0[value='counter']
                )
                > MemberExpression:has(
                    > Identifier.property[name='apply']
                )
                > CallExpression.object:has(
                    > MemberExpression.callee
                    > Identifier.property[name='constructor']
                )
                > StringLiteral.arguments.0[value='while (true) {}']`
            );
            if (matches.length !== 1) {
                return;
            }

            if (path.node.id) {
                const binding = path.scope.getBinding(path.node.id.name);
                if (binding) {
                    for (const reference of binding.referencePaths) {
                        if (path.isAncestor(reference)) {
                            continue;
                        }

                        if (!bq.matches(
                            reference,
                            bq.parse(
                                `CallExpression
                                > FunctionExpression
                                CallExpression:has(
                                    > MemberExpression.callee
                                    > Identifier.property[name='setInterval']
                                ):has(
                                    > NumericLiteral.arguments.1[value=4000]
                                )
                                > Identifier.arguments.0`
                            ),
                            {}
                        )) {
                            continue;
                        }

                        reference.getFunctionParent()!.parentPath!.remove();
                        changed = true;
                    }
                }
            }

            path.remove();
        }
    });

    const emptyIIFEMatches = bq.query(
        path,
        bq.parse(
            `ExpressionStatement:has(
                > CallExpression
                > FunctionExpression
                > BlockStatement[body.length=0]
            )`
        ),
    );
    for (const iife of emptyIIFEMatches) {
        iife.remove();
        changed = true;
    }

    return changed;
}