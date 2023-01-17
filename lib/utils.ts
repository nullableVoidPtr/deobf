import * as t from "@babel/types";
import _traverse, { NodePath, NodePathResult } from "@babel/traverse";
const traverse: typeof _traverse = (<any>_traverse).default;

export function inlineProxyCall(
	callExpr: NodePath<t.CallExpression>,
	proxyFunc: NodePath<t.Function>,
	args: t.Expression[]
) {
	const params = proxyFunc.get("params");
	if (!params.every((p): p is NodePath<t.Identifier> => p.isIdentifier())) {
		throw new Error("unsupported func args");
	}
	const argMap = new Map<string, t.Expression>();
	(<NodePathResult<t.Identifier[]>>params).forEach((param, i) => {
		argMap.set(param.node.name, args[i]);
	});
	let returnExp: t.Expression;
	const body = proxyFunc.get("body");
	if (body.isBlockStatement()) {
		const statements = body.get("body");
		if (statements.length !== 1) {
			throw Error("Abnormal proxy function (body not one statement)");
		}
		const stmt = statements[0];
		if (!stmt.isReturnStatement()) {
			throw Error(
				"Abnormal proxy function (only statement not a return)"
			);
		}
		const retExpr = stmt.get("argument");
		if (!retExpr.isExpression()) {
			throw Error("Abnormal proxy function (return value is undefined)");
		}
		returnExp = t.cloneNode(retExpr.node);
	} else if (body.isExpression()) {
		returnExp = t.cloneNode(body.node);
	}

	traverse(returnExp!, {
		noScope: true,
		Identifier(path: NodePath<t.Identifier>) {
			const name = argMap.get(path.node.name);
			if (name) {
				path.replaceWith(name);
			}
		},
	});

	callExpr.replaceWith(returnExp!);
}
