const BasePass = require('../BasePass.js');
const estraverse = require('estraverse');
const utils = require('../../utils.js')

const NodeToExpressionMap = {
	'ExpressionStatement': 'expression',
	'IfStatement': 'test',
	'SwitchStatement': 'discriminant',
};

module.exports = class SequenceStatementPass extends BasePass {
	static _transform(tree) {
		let replaced = false;
		estraverse.replace(tree, {
			enter(scope) {
				if (['Program', 'BlockStatement'].indexOf(scope.type) !== -1) {
					while (true) {
						let preceding;
						let index = -1;
						for (let i in scope.body) {
							let node = scope.body[i];
							let expressionProperty;
							let expressions;
							if (node.type in NodeToExpressionMap &&
								(expressionProperty = NodeToExpressionMap[node.type],
								node[expressionProperty].type === 'SequenceExpression')) {
								expressions = node[expressionProperty].expressions;
							} else {
								continue;
							}
							index = i;
							preceding = expressions.splice(0, expressions.length - 1).map(e => ({
								type: 'ExpressionStatement',
								expression: e,
							}));
							node[expressionProperty] = expressions[0];
							break;
						}
						if (index === -1) {
							break;
						}
						scope.body.splice(index, 0, ...preceding)
						replaced = true;
					}
				}
			}
		});
		return replaced;
	}
}