const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isConsoleDisableFunc(decl) {
}

module.exports = class CallControllerRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'console-enable-pass': {
				type: 'boolean',
				default: true,
			},
		};
	}

	static isEnabled(options) {
		return options.consoleEnablePass;
	}
	
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		let callControllerRemoved = false;
		estraverse.replace(tree, {
			enter: (scope) => {
				if (scope.type === 'BlockStatement' &&
					scope.body.length >= 2) {
					let callControllerIndex = scope.body.findIndex((varDecl) => {
						if (!utils.specMatch(varDecl, {
							type: 'VariableDeclaration',
							declarations: [{
								type: 'VariableDeclarator',
								init: {
									type: 'CallExpression',
									callee: {
										type: 'FunctionExpression',
									},
								}
							}],	
						})) {
							return false;
						}
						let iife = varDecl.declarations[0].init.callee;

						let returnStatement = iife.body.body.find((statement) =>
							utils.specMatch(statement, {
							type: 'ReturnStatement',
							argument: {
								type: 'FunctionExpression',
							}
						}) && statement.argument.params.length === 2);
						if (typeof returnStatement === 'undefined') {
							return false;
						}

						return returnStatement.argument.body.body.findIndex((constDecl) => 
							utils.specMatch(constDecl, {
								type: 'VariableDeclaration',
								declarations: [{
									init: {
										type: 'ConditionalExpression',
										test: {
											type: 'Identifier',
										},
										consequent: {
											type: 'FunctionExpression',
										},
										alternate: {
											type: 'FunctionExpression',
										},
									},
								}],
							})
						) !== -1;

					});
					if (callControllerIndex === -1) {
						return;
					}
					
					let callControllerIdent = scope.body[callControllerIndex].declarations[0].id.name;
					let isCalled = false;
					estraverse.traverse(scope, {
						enter: (call) => {
							if (utils.specMatch(call, {
								type: 'CallExpression',
								callee: {
									type: 'Identifier',
									name: callControllerIdent,
								},
							})) {
								isCalled = true;
								return estraverse.VisitorOption.Break;
							}
						}
					});
					if (isCalled) {
						return;
					}
					callControllerRemoved = true;
					scope.body.splice(callControllerIndex, 1);
					return scope;
				}
			}
		});
		return callControllerRemoved;
	}
}

