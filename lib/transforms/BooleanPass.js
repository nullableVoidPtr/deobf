import estraverse from 'estraverse';
import utils from '../utils.js';
import BasePass from './BasePass.js'

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

export const repeatUntilStable = true;

export default class extends BasePass {
	static _transform(tree) {
		let booleanReplaced = false;
		estraverse.replace(tree, {
			leave(node) {
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
					booleanReplaced = true;
					if (node.left.name === 'NaN' || node.right.name === 'NaN') {
						return {
							type: 'Literal',
							value: false,
						};
					}
					return {
						type: 'Literal',
						value: true,
					};
				}

				if (utils.specMatch(node, utils.parseExpression('$_Identifier_ !== $_Identifier_')) &&
					node.left.name === node.right.name) {
					booleanReplaced = true;
					if (node.left.name === 'NaN' || node.right.name === 'NaN') {
						return {
							type: 'Literal',
							value: true,
						};
					}
					return {
						type: 'Literal',
						value: false,
					};
				}

				if (utils.specMatch(node, utils.parseExpression('$_Literal_ === $_Literal_'))) {
					booleanReplaced = true;
					return {
						type: 'Literal',
						value: node.left.value === node.right.value,
					};
				}

				if (utils.specMatch(node, utils.parseExpression('$_Literal_ !== $_Literal_'))) {
					booleanReplaced = true;
					return {
						type: 'Literal',
						value: node.left.value !== node.right.value,
					};
				}
			}
		});
		return booleanReplaced;
	}
}
