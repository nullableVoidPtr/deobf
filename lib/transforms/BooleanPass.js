const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

module.exports = class BooleanPass extends BasePass {
	static _transform(tree) {
		let booleanReplaced = false;
		estraverse.replace(tree, {
			enter: (node) => {
				if (utils.specMatch(node, {
						type: 'UnaryExpression',
						operator: '!',
					})) {
					if (utils.specMatch(node.argument, {
						type: 'UnaryExpression',
						operator: '!',
						argument: {
							type: 'ArrayExpression'
						}
					})) {
						booleanReplaced = true;
						return {
							type: 'Literal',
							value: true,
						};
					} else if (utils.specMatch(node.argument, {
						type: 'ArrayExpression',
					})) {
						booleanReplaced = true;
						return {
							type: 'Literal',
							value: false,
						};
					}
				}
			}
		});
		return booleanReplaced;
	}
}
