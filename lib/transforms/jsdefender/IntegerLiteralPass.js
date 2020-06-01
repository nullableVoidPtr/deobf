const BasePass = require('./../BasePass.js');
const utils = require('../../utils.js');
const estraverse = require('estraverse');

module.exports = class IntegerLiteralPass extends BasePass {
	static _transform(tree, options) {
		estraverse.replace(tree, {
			leave(node) {
				if (utils.specMatch(node, {
					type: 'BinaryExpression',
					left: {
						type: 'Literal',
					},
					right: {
						type: 'Literal',
					},
				})) {
					let left = node.left.value;
					let right = node.right.value;
					let result;
					switch (node.operator) {
						case '+':
							result = left + right;
							break;
						case '-':
							result = left - right;
							break;
						case '^':
							result = left ^ right;
							break;
						case '%':
							result = left % right;
							break;
						case '&':
							result = left & right;
							break;
					}
					return {
						type: 'Literal',
						value: result,
					}
				}
			}
		});
	}
}

