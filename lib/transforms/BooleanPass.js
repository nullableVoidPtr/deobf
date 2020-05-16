const BasePass = require('./BasePass.js')
const estraverse = require('estraverse')

module.exports = class BooleanPass extends BasePass {
	static _transform(tree) {
		return estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'UnaryExpression' &&
					node.operator === '!') {
					if (node.argument.type === 'UnaryExpression' &&
						node.argument.operator === '!' &&
						node.argument.argument.type === 'ArrayExpression') {
						return {
							type: 'Literal',
							value: true,
						}
					}
					if (node.argument.type === 'ArrayExpression') {
						return {
							type: 'Literal',
							value: false,
						}
					}
				}
			}
		});
	}
}
