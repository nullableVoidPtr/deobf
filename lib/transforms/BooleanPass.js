const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

const obfuscatedTrues = [
	utils.parseExpression('!false'),
	utils.parseExpression('!0'),
];

const obfuscatedFalses = [
	utils.parseExpression('!true'),
	utils.parseExpression('!1'),
	{
		type: 'UnaryExpression',
		operator: '!',
		argument: {
			type: 'ArrayExpression'
		}
	}, {
		type: 'UnaryExpression',
		operator: '!',
		argument: {
			type: 'ObjectExpression'
		}
	},
];

module.exports = class BooleanPass extends BasePass {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree) {
		let booleanReplaced = false;
		estraverse.replace(tree, {
			enter: (node) => {
				for (let obfuscatedTrue of obfuscatedTrues) {
					if (utils.specMatch(node, obfuscatedTrue)) {
						booleanReplaced = true;
						return {
							type: 'Literal',
							value: true,
						};
					}
				}
				
				for (let obfuscatedFalse of obfuscatedFalses) {
					if (utils.specMatch(node, obfuscatedFalse)) {
						booleanReplaced = true;
						return {
							type: 'Literal',
							value: false,
						};
					}
				}
				
				if (utils.specMatch(node, utils.parseExpression('$_Identifier_ === $_Identifier_')) &&
					node.left.name === node.right.name) {
					return {
						type: 'Literal',
						value: true,
					};
				}
				
				if (utils.specMatch(node, utils.parseExpression('$_Identifier_ !== $_Identifier_')) &&
					node.left.name !== node.right.name) {
					return {
						type: 'Literal',
						value: true,
					};
				}
			}
		});
		return booleanReplaced;
	}
}
