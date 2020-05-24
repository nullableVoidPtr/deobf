const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

module.exports = class StringFoldPass extends BasePass {
	static get repeatUntilStable() {
		return true;
	}
	static _transform(tree) {
		let stringFolded = false;
		estraverse.replace(tree, {
			enter: (expression) => {
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

