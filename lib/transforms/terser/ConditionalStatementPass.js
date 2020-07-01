import estraverse from 'estraverse';
import * as utils from '../../utils.js';

export default tree => {
	let replaced = false;
	estraverse.traverse(tree, {
		enter(scope) {
			utils.modifyScope(scope,
				(statement, index, body) => {
					if (index === -1) {
						return;
					}

					let expression = statement.expression;
					body.splice(index, 1, {
						type: 'IfStatement',
						test: (expression.operator === '||') ? {
							type: 'UnaryExpression',
							operator: '!',
							prefix: true,
							argument: expression.left,
						} : expression.left,
						consequent: {
							type: 'BlockStatement',
							body: [{
								type: 'ExpressionStatement',
								expression: expression.right,
							}],
						},
						alternate: null,
					});
					replaced = true;
				},
				statement => utils.specMatch(statement, {
					type: 'ExpressionStatement',
					expression: {
						type: 'LogicalExpression'
					}
				}) && ['&&', '||'].includes(statement.expression.operator)
			);
			utils.modifyScope(scope,
				(statement, index, body) => {
					if (index === -1) {
						return;
					}

					let expression = statement.expression;
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
					body.splice(index, 1, {
						type: 'IfStatement',
						test: expression.test,
						consequent: consequentBody,
						alternate: alternateBody,
					});
					replaced = true;
				},
				statement => utils.specMatch(statement, {
					type: 'ExpressionStatement',
					expression: {
						type: 'ConditionalExpression'
					}
				}));
		}
	});
	return replaced;
};
