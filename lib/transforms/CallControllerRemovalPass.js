const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isCallController(decl) {
	if (!utils.specMatch(decl, {
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
	let iife = decl.declarations[0].init.callee;

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
}

module.exports = class CallControllerRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'call-controller-removal-pass': {
				type: 'boolean',
				default: true,
			},
		};
	}

	static isEnabled(options) {
		return options.callControllerRemovalPass;
	}

	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		let callControllerRemoved = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				if (['BlockStatement', 'Program'].indexOf(scope.type) !== -1 &&
					scope.body.length >= 2) {
					let callControllerIndex = scope.body.findIndex((varDecl) => isCallController(varDecl));
					if (callControllerIndex === -1) {
						return;
					}

					let callControllerIdent = scope.body[callControllerIndex].declarations[0].id.name;
					console.log(callControllerIdent);
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
					if (!isCalled) {
						callControllerRemoved = true;
						scope.body.splice(callControllerIndex, 1);
					}
				}
			}
		});
		return callControllerRemoved;
	}
}

