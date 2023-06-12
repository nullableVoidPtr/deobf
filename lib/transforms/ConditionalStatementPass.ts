import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import * as bq from 'babylon-query'

export default (path: NodePath): boolean => {
	let changed = false;
	path.traverse({
		ExpressionStatement(path) {
			const expression = path.get('expression');
			if (expression.isConditionalExpression()) {
				path.replaceWith(
					t.ifStatement(
						expression.node.test,
						t.blockStatement([
							t.expressionStatement(expression.node.consequent),
						]),
						t.blockStatement([
							t.expressionStatement(expression.node.alternate),
						])
					)
				);

				changed = true;
			} else if (expression.isLogicalExpression()) {
				let test = expression.node.left;
				if (expression.node.operator == '??') return;
				if (expression.node.operator == '||') {
					if (t.isUnaryExpression(test, {operator: '!', prefix: true})) {
						test = test.argument;
					} else {
						test = t.unaryExpression('!', test);
					}
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
		IfStatement: {
			exit(path) {
				const alternate = path.get('alternate');
				if (!alternate.isBlockStatement()) return;

				const inlineMatches = bq.query(alternate, 'BlockStatement:root[body.length=1] > IfStatement.body.0');
				if (inlineMatches.length !== 1) return;

				alternate.replaceWith(inlineMatches[0]);
				changed = true;
			}
		},
		ReturnStatement(path) {
			const expression = path.get('argument');
			if (expression.isConditionalExpression()) {
				path.replaceWithMultiple([
					t.ifStatement(
						expression.node.test,
						t.blockStatement([
							t.returnStatement(expression.node.consequent),
						]),
					),
					t.returnStatement(expression.node.alternate),
				]);

				changed = true;
			} else if (expression.isLogicalExpression()) {
				let test = expression.node.left;
				let value: boolean;
				if (expression.node.operator == '&&') {
					value = false;
					if (t.isUnaryExpression(test, {operator: '!', prefix: true})) {
						test = test.argument;
					} else {
						test = t.unaryExpression('!', test);
					}
				} else if (expression.node.operator == '||') {
					value = true;
				} else {
					return;
				}

				path.replaceWithMultiple([
					t.ifStatement(
						test,
						t.blockStatement([
							t.returnStatement(t.booleanLiteral(value)),
						]),
						null
					),
					t.returnStatement(expression.node.right)
				]);

				changed = true;
			}
		},
	});

	return changed;
};
