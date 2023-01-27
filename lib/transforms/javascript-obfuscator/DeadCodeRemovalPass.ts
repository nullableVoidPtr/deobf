import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";
import * as bq from "babylon-query";

export default (path: NodePath): boolean => {
	path.traverse({
		BlockStatement(path) {
			const deadCodeMatches = <NodePath<t.IfStatement>[]>(
				bq.query(path, ":root > IfStatement:has(> BooleanLiteral.test)")
			);
			for (const match of deadCodeMatches) {
				const test = <NodePath<t.BooleanLiteral>>match.get("test");
				const consequent = match.get("consequent");
				const alternate = match.get("alternate");
				if (test.node.value) {
					if (consequent.isBlockStatement()) {
						match.replaceWithMultiple(consequent.node.body);
					} else {
						match.replaceWith(consequent.node);
					}
				} else {
					if (alternate.node == null) {
						throw new Error("null alternate branch");
					}
					if (alternate.isBlockStatement()) {
						match.replaceWithMultiple(alternate.node.body);
					} else {
						match.replaceWith(alternate.node);
					}
				}
			}
		},
		ConditionalExpression(path) {
			const test = path.get("test");
			const consequent = path.get("consequent");
			const alternate = path.get("alternate");
			if (test.isBooleanLiteral({ value: true })) {
				path.replaceWith(consequent.node);
			} else if (test.isBooleanLiteral({ value: false })) {
				path.replaceWith(alternate.node);
			}
		},
	});
	return true;
};
