import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		ExpressionStatement(path) {
			const expression = path.get("expression");
			if (!expression.isSequenceExpression()) {
				return;
			}

			path.replaceWithMultiple(expression.node.expressions.map(t.expressionStatement));
		},
		SequenceExpression(path) {
			const { parentPath } = path;
			const { expressions } = path.node;
			const newStatements = expressions
				.slice(0, -1)
				.map(t.expressionStatement);

			if (parentPath.isForStatement()) {
				if (path.key == "init") {
					parentPath.insertBefore(newStatements);
					expressions.splice(0, newStatements.length);
				} else if (path.key == "update") {
					const body = parentPath.get("body");
					if (body.isBlockStatement()) {
						body.node.body.push(...newStatements);
					} else {
						body.replaceWith(
							t.blockStatement([body.node, ...newStatements])
						);
					}
					expressions.splice(0, newStatements.length);
				}
			} else if (
				(parentPath.isSwitchStatement() &&
					path.key == "discriminant") ||
				parentPath.isReturnStatement()
			) {
				parentPath.insertBefore(newStatements);
				expressions.splice(0, newStatements.length);
			}
		},
	});

	return changed;
};
