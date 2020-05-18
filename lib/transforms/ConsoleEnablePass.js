const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isConsoleDisableFunc(decl) {
}

module.exports = class ConsoleEnablePass extends BasePass {
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

	static _transform(tree, options) {
		estraverse.replace(tree, {
			enter: (scope) => {
				if (scope.type === 'BlockStatement' &&
					scope.body.length >= 2) {
					let consoleDisableIdent;
					let consoleDisableIndex = scope.body.findIndex((varDecl) => {
						if (!utils.specMatch(varDecl, {
							type: 'VariableDeclaration',
							declarations: [{
								type: 'VariableDeclarator',
								init: {
									type: 'CallExpression',
									callee: {
										type: 'Identifier',
									},
									arguments: [{
										type: 'ThisExpression'
									}, {
										type: 'FunctionExpression',
									}],
								}
							}],
						})) {
							return false;
						}
						let innerFunc = varDecl.declarations[0].init.arguments[1];
						let isAssigned = Object.fromEntries([
							'log',
							'warn',
							'debug',
							'info',
							'error',
							'exception',
							'trace'].map((key) => [key, false]));
						estraverse.traverse(innerFunc, {
							enter: (assign) => {
								if (utils.specMatch(assign, {
									type: 'AssignmentExpression',
									left: {
										type: 'MemberExpression',
										object: {
											type: 'MemberExpression',
											property: {
												type: 'Literal',
												value: 'console',
											}
										},
										property: {
											type: 'Literal',
										},
									},
								}) &&
									assign.left.property.value in isAssigned) {
									isAssigned[assign.left.property.value] = true;
									return estraverse.VisitorOption.Skip;
								}
							}
						});
						if (!Object.values(isAssigned).every(Boolean)) {
							return false;
						}
						consoleDisableIdent = varDecl.declarations[0].id.name;
						return true;
					});
					if (consoleDisableIndex === -1) {
						return;
					}
					scope.body.splice(consoleDisableIndex, 1);
					let callIndex = scope.body.findIndex((call) => 
						utils.specMatch(call, {
							type: 'ExpressionStatement',
							expression: {
								type: 'CallExpression',
								callee: {
									type: 'Identifier',
									name: consoleDisableIdent,
								},
							}
						})
					);
					if (callIndex === -1) {
						return;
					}
					scope.body.splice(callIndex, 1);
					return scope;
				}
			}
		});
	}
}
