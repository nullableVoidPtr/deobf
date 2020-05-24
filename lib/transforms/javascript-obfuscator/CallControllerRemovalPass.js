const BasePass = require('./../BasePass.js');
const estraverse = require('estraverse');
const utils = require('../../utils.js')

function isCallController(decl) {
	if (!utils.specMatch(decl, {
		type: 'VariableDeclaration',
		declarations: [{
			init: utils.parseExpression('$_FunctionExpression_()')
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
				init: utils.parseExpression('($_Identifier_) ? $_FunctionExpression_ : $_FunctionExpression_')
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
					let processedCallControllerIdents = [];
					while (true) {
						let callControllerIndex = scope.body.findIndex((varDecl) => isCallController(varDecl) &&
							processedCallControllerIdents.indexOf(varDecl.declarations[0].id.name) === -1);
						if (callControllerIndex === -1) {
							break;
						}

						let callControllerIdent = scope.body[callControllerIndex].declarations[0].id.name;
						let isCalled = false;
						estraverse.traverse(scope, {
							enter: (call) => {
								if (utils.specMatch(call, utils.parseExpression(`${callControllerIdent}()`))) {
									isCalled = true;
									return estraverse.VisitorOption.Break;
								}
							}
						});
						if (!isCalled) {
							callControllerRemoved = true;
							scope.body.splice(callControllerIndex, 1);
						}
						processedCallControllerIdents.push(callControllerIdent);
					}
				}
			}
		});
		return callControllerRemoved;
	}
}

