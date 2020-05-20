const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isDispatcher(statement, execOrderIdent, execCounterIdent) {
	if (utils.specMatch(statement, {
		type: 'WhileStatement',
		test: {
			type: 'Literal',
			value: true,
		},
		body: {
			type: 'BlockStatement',
			body: [{
				type: 'SwitchStatement',
				discriminant: {
					type: 'MemberExpression',
					object: {
						type: 'Identifier',
						name: execOrderIdent,
					},
					property: {
						type: 'UpdateExpression',
						operator: '++',
						argument: {
							type: 'Identifier',
							name: execCounterIdent,
						}
					}
				},
			}]
		}
	})) {
		if (statement.body.body[0].cases.every((switchCase) => switchCase.test.type === 'Literal')) {
			return true;
		}
	}
}

module.exports = class ControlFlowRecovery extends BasePass {
	static get yargsOptions() {
		return {
			'control-flow-recovery-pass': {
				type: 'boolean',
				default: true,
			}
		};
	}

	static isEnabled(options) {
		return options.controlFlowRecoveryPass;
	}

	static _transform(tree) {
		let controlFlowRecovered = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				let execOrderIdent;
				let execOrder;
				let execCounterIdent;
				if (!(scope.type === 'BlockStatement' &&
					scope.body.length >= 2)) {
					return;
				}
				let varDeclIndex = scope.body.findIndex((varDecl) => {
					if (!(varDecl.type == 'VariableDeclaration' &&
						varDecl.declarations.length === 2)) {
						return false;
					}

					let execOrderDecl = varDecl.declarations[0];
					if (!utils.specMatch(execOrderDecl, {
						init: {
							type: 'CallExpression',
							callee: {
								type: 'MemberExpression',
								object: {
									type: 'Literal',
								},
								property: {
									type: 'Identifier',
									name: 'split',
								},
							},
							arguments: [{
								value: '|'
							}],
						},
					})) {
						return false;
					}

					let execCounterDecl = varDecl.declarations[1];
					if (!utils.specMatch(execCounterDecl, {
						init: {
							type: 'Literal',
							value: 0,
						},
					})) {
						return false;
					}
					execOrderIdent = execOrderDecl.id.name;
					execOrder = execOrderDecl.init.callee.object.value.split('|');
					execCounterIdent = execCounterDecl.id.name;
					return true;
				});
				if (varDeclIndex === -1 ||
					varDeclIndex === scope.body.length - 1 ||
					!isDispatcher(scope.body[varDeclIndex + 1],
						execOrderIdent, execCounterIdent)) {
					return;
				}

				let switchCases = scope.body[varDeclIndex + 1].body.body[0].cases;
				let caseMap = Object.fromEntries(switchCases.map((switchCase) => {
					let consequent = switchCase.consequent;
					if (consequent[consequent.length - 1].type === 'ContinueStatement') {
						consequent = consequent.slice(0, consequent.length - 1);
					}
					return [switchCase.test.value, consequent];
				}));
				let orderedStatements = execOrder.flatMap((n) => caseMap[n]);
				scope.body.splice(varDeclIndex, 2, ...orderedStatements);
				controlFlowRecovered = true;
			}
		});
		utils.removeEmptyVarDecls(tree);
		return controlFlowRecovered;
	}
}
