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
		estraverse.traverse(tree, {
			enter: (scope) => {
				if (['BlockStatement', 'Program'].indexOf(scope.type) !== -1 &&
					scope.body.length >= 2) {
					let consoleDisableIdent;
					let consoleDisableIndex = scope.body.findIndex((varDecl) => {
						if (!utils.specMatch(varDecl, {
							type: 'VariableDeclaration',
							declarations: [{
								init: utils.parseExpression('$_Identifier_(this, $_FunctionExpression_)')
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
												type: 'Identifier',
												name: 'console',
											}
										},
										property: {
											type: 'Identifier',
										},
									},
								}) &&
									assign.left.property.name in isAssigned) {
									isAssigned[assign.left.property.name] = true;
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
						utils.specMatch(call, utils.parseStatement(`${consoleDisableIdent}()`))
					);
					if (callIndex === -1) {
						return;
					}
					scope.body.splice(callIndex, 1);
				}
			}
		});
	}
}
