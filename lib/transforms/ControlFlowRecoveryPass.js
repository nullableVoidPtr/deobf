const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

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
		estraverse.replace(tree, {
			enter: (scope) => {
				let execOrderIdent;
				let execOrder;
				let execCounterIdent;
				if (scope.type === 'BlockStatement' &&
					scope.body.length >= 2) {
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
											type: 'Literal',
											value: 'split',
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
					if (varDeclIndex === -1) {
						return;
					}
					scope.body.splice(varDeclIndex, 1);
					let orderedStatements;
					let loopIndex = scope.body.findIndex((statement) => {
						if (!utils.specMatch(statement, {
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
							return false;
						}
						let switchCases = statement.body.body[0].cases;
						if (!switchCases.every((switchCase) => switchCase.test.type === 'Literal')) {
							return false;
						}
						controlFlowRecovered = true;
						let caseMap = Object.fromEntries(switchCases.map((switchCase) => {
							let consequent = switchCase.consequent;
							if (consequent[consequent.length - 1].type === 'ContinueStatement') {
								consequent = consequent.slice(0, consequent.length - 1);
							}
							return [switchCase.test.value, consequent];
						}));
						orderedStatements = execOrder.flatMap((n) => caseMap[n]);
						return true;
					});
					if (loopIndex === -1) {
						return;
					}
					scope.body.splice(loopIndex, 1, ...orderedStatements);
					return scope;
				}
			}
		});
		utils.removeEmptyVarDecls(tree);
		return controlFlowRecovered;
	}
}
