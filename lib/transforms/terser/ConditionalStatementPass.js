import estraverse from 'estraverse';
import utils from '../../utils.js';

export default (tree) => {
	let replaced = false;
	estraverse.replace(tree, {
		enter(scope) {
			if (['Program', 'BlockStatement'].includes(scope.type)) {
				while (true) {
					let index = scope.body.findIndex((statement) =>
						utils.specMatch(statement, {
							type: 'ExpressionStatement',
							expression: {
								type: 'LogicalExpression'
							}
						}) &&
						['&&', '||'].includes(statement.expression.operator))
					if (index === -1) {
						break;
					}
					let expression = scope.body[index].expression;
					let ifBody = {
						type: 'BlockStatement',
						body: [{
							type: 'ExpressionStatement',
							expression: expression.right,
						}],
					};
					scope.body.splice(index, 1, {
						type: 'IfStatement',
						test: (expression.operator === '||') ? {
							type: 'UnaryExpression',
							operator: '!',
							prefix: true,
							argument: expression.left,
						} : expression.left,
						consequent: ifBody,
					});
					replaced = true;
				}
				while (true) {
					let index = scope.body.findIndex((statement) =>
						utils.specMatch(statement, {
							type: 'ExpressionStatement',
							expression: {
								type: 'ConditionalExpression'
							}
						}))
					if (index === -1) {
						break;
					}
					let expression = scope.body[index].expression;
					let consequentBody = {
						type: 'BlockStatement',
						body: [{
							type: 'ExpressionStatement',
							expression: expression.consequent,
						}],
					};
					let alternateBody = {
						type: 'BlockStatement',
						body: [{
							type: 'ExpressionStatement',
							expression: expression.alternate,
						}],
					};
					scope.body.splice(index, 1, {
						type: 'IfStatement',
						test: expression.test,
						consequent: consequentBody,
						alternate: alternateBody,
					});
					replaced = true;
				}
			}
		}
	});
	return replaced;
}
