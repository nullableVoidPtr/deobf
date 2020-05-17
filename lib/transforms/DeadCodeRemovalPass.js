const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');

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
		estraverse.replace(tree, {
			enter: (scope) => {
				if (scope.type === 'BlockStatement') {
					let activeStatements;
					let ifIndex = scope.body.findIndex((statement) => {
						if (statement.type === 'IfStatement' &&
							statement.test.type === 'BinaryExpression' &&
							statement.test.left.type === 'Literal' &&
							statement.test.right.type === 'Literal') {
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
						}
						return false;
					});
					if (ifIndex !== -1) {
						deadCodeRemoved = true;
						scope.body.splice(ifIndex, 1, ...activeStatements);
						return scope;
					}
				}
			}
		});
		return deadCodeRemoved;
	}
}
