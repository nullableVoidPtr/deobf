import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		ExpressionStatement(path) {
			const expression = path.get("expression");
			if (expression.isConditionalExpression()) {
				path.replaceWith(
					t.ifStatement(
						expression.node.test,
						t.blockStatement([
							t.expressionStatement(expression.node.consequent),
						]),
						expression.node.alternate
							? t.blockStatement([
									t.expressionStatement(
										expression.node.alternate
									),
							  ])
							: null
					)
				);

				changed = true;
			} else if (expression.isLogicalExpression()) {
				let test = expression.node.left;
				if (expression.node.operator == "??") {
					return;
				} else if (expression.node.operator == "||") {
					test = t.unaryExpression("!", test);
				}

				path.replaceWith(
					t.ifStatement(
						test,
						t.blockStatement([
							t.expressionStatement(expression.node.right),
						]),
						null
					)
				);

				changed = true;
			}
		},
	});

	return changed;
};
