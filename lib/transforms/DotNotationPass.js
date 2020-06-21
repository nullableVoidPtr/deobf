const estraverse = require('estraverse');
const utils = require('../utils.js')

module.exports = class DotNotationPass extends require('./BasePass.js') {
	static _transform(tree) {
		let replaced = false;
		estraverse.traverse(tree, {
			enter: (node) => {
				if (utils.specMatch(node, utils.parseExpression('$_IGNORE_[$_Literal_]')) &&
					node.property.value.length <= 20 &&
					utils.isValidIdentifier(node.property.value)
				) {
					replaced = true;
					node.computed = false;
					node.property = {
						type: 'Identifier',
						name: node.property.value
					};
				} else if (utils.specMatch(node, {
					type: 'Property',
					key: {
						type: 'Literal'
					}
				}) &&
					utils.isValidIdentifier(node.key.value)) {
					replaced = true;
					node.key.type = 'Identifier';
					node.key.name = node.key.value;
					node.computed = false;
					delete node.key.value;
				}
			}
		});
		return replaced;
	}
}
