const estraverse = require('estraverse');
const utils = require('../../utils.js')

module.exports = class StringFoldPass extends require('../BasePass.js') {
	static _transform(tree) {
		let stringFolded = false;
		estraverse.replace(tree, {
			leave(expression) {
				if (utils.specMatch(expression, utils.parseExpression('$_Literal_ + $_Literal_'))) {
					stringFolded = true;
					return {
						type: 'Literal',
						value:  expression.left.value + expression.right.value,
					};
				}
			}
		});
		return stringFolded;
	}
}

