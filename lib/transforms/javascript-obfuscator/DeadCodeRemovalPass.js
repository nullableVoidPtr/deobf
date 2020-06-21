const estraverse = require('estraverse');
const utils = require('../../utils.js')

module.exports = class DeadCodeRemovalPass extends require('../BasePass.js') {
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
				if (scope.type !== 'BlockStatement') {
					return;
				}
				let ifIndex = scope.body.findIndex((statement) =>
					utils.specMatch(statement, {
						type: 'IfStatement',
						test: {
							type: 'Literal',
						}
					}) && statement.consequent !== null);
				if (ifIndex === -1) {
					return;
				}
				let ifStatement = scope.body[ifIndex];
				let activeStatements = (ifStatement.test.value) ? ifStatement.consequent : ifStatement.alternate;
				deadCodeRemoved = true;
				scope.body.splice(ifIndex, 1, ...(activeStatements.type === 'BlockStatement') ?
					activeStatements.body :
					[activeStatements]);
			}
		});
		return deadCodeRemoved;
	}
}
