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
const debugProtSelector = bq.parse(`ReturnStatement
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
    > StringLiteral.arguments.0[value='while (true) {}']`);
const debugCallSelector = bq.parse(`CallExpression
    > FunctionExpression
    CallExpression:has(
        > MemberExpression.callee
        > Identifier.property[name='setInterval']
    ):has(
        > NumericLiteral.arguments.1[value=4000]
    )
    > Identifier.arguments.0`);

export default (path: NodePath): boolean => {
    let changed = false;

    path.traverse({
        VariableDeclarator(path) {
            const callControllerInit = path.get("init");
            if (!callControllerInit.isCallExpression()) {
                return;
            }

            const callController = callControllerInit.get('callee');
            if (!callController.isFunctionExpression()) {
                return;
            }
            const body = callController.get('body').get('body');
            if (body.length !== 2) {
                return;
            }

            const [declarations, returnStmt] = body;
            if (!declarations.isVariableDeclaration()) {
                return;
            }
            if (!returnStmt.isReturnStatement()) {
                return;
            }

            const innerClosure = returnStmt.get('argument');
            if (!innerClosure.isFunctionExpression()) {
                return;
            }

            const params = innerClosure.get("params");
            if (params.length !== 2 || !params.every((p) => p.isIdentifier())) {
                return;
            }

            if (!bq.matches(innerClosure, innerFuncSelector, {})) {
                return;
            }

            const binding = Object.values(path.scope.getAllBindings()).find(b => b.path === path);
            if (binding == null) {
                return;
            }

            for (const bindingRef of binding.referencePaths) {
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

                if (!path.removed) {
                    path.remove();
                }
            }
        },
        FunctionDeclaration(path) {
            const body = path.get('body').get('body');
            if (body.length !== 2) {
                return;
            }

            const innerFunc = body[0];
            const matches = bq.query(innerFunc, debugProtSelector);
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
                            debugCallSelector,
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
        `ExpressionStatement:has(
            > CallExpression
            > FunctionExpression
            > BlockStatement[body.length=0]
        )`
    );
    for (const iife of emptyIIFEMatches) {
        iife.remove();
        changed = true;
    }

    return changed;
}