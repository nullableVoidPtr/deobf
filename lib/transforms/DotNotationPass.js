const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

module.exports = class DotNotationPass extends BasePass {
	static _transform(tree) {
		let replaced = false;
		estraverse.traverse(tree, {
			enter: (node) => {
				if (utils.specMatch(node, {
					type: 'MemberExpression',
					computed: true,
					property: {
						type: 'Literal',
					},
				}) &&
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
					delete node.key.value;
				}
			}
		});
		return replaced;
	}
}
