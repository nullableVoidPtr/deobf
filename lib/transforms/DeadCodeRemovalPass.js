const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

module.exports = class DeadCodeRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'dead-code-removal-pass': {
				type: 'boolean',
				default: true,
			}
		};
	}
	
	static isEnabled(options) {
		return options.deadCodeRemovalPass;
	}

	static _transform(tree) {
		let deadCodeRemoved = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				if (scope.type === 'BlockStatement') {
					let activeStatements;
					let ifIndex = scope.body.findIndex((statement) => {
						if (!(utils.specMatch(statement, {
								type: 'IfStatement',
								test: {
									type: 'BinaryExpression',
									left: {
										type: 'Literal',
									},
									right: {
										type: 'Literal',
									},
								}
							}) && statement.consequent !== null)) {
							return false;
						}
						let left = statement.test.left.value;
						let right = statement.test.right.value;
						switch (statement.test.operator) {
							case '===':
								activeStatements = (left === right) ? statement.consequent : statement.alternate;
								break;
							case '!==':
								activeStatements = (left !== right) ? statement.consequent : statement.alternate;
								break;
						}
						if (activeStatements.type === 'BlockStatement') {
							activeStatements = activeStatements.body;
						} else {
							activeStatements = [activeStatements];
						}
						return true;
					});
					if (ifIndex !== -1) {
						deadCodeRemoved = true;
						scope.body.splice(ifIndex, 1, ...activeStatements);
					}
				}
			}
		});
		return deadCodeRemoved;
	}
}
