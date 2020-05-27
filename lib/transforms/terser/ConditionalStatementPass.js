const BasePass = require('../BasePass.js');
const estraverse = require('estraverse');
const utils = require('../../utils.js')

module.exports = class ConditionalStatementPass extends BasePass {
	static _transform(tree) {
		let replaced = false;
		estraverse.replace(tree, {
			enter(scope) {
				if (['Program', 'BlockStatement'].indexOf(scope.type) !== -1) {
					while (true) {
						let index = scope.body.findIndex((statement) =>
							utils.specMatch(statement, {
								type: 'ExpressionStatement',
								expression: {
									type: 'LogicalExpression'
								}
							}) &&
							['&&', '||'].indexOf(statement.expression.operator) !== -1)
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
}
