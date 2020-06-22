const estraverse = require('estraverse');
const utils = require('../../utils.js')

function isCallController(decl) {
	if (!utils.specMatch(decl, utils.parseStatement('var $_IGNORE_ = $_FunctionExpression_()'))) {
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
		utils.specMatch(constDecl, utils.parseStatement('var $_IGNORE_ = ($_Identifier_) ? $_FunctionExpression_ : $_FunctionExpression_'))
	) !== -1;
}

module.exports = class CallControllerRemovalPass extends require('../BasePass.js') {
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
			enter: scope => utils.modifyScope(scope,
				(callController, index, body) => {
					let callControllerIdent = callController.declarations[0].id.name;
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
						body.splice(index, 1);
					}
				},
				isCallController,
				varDecl => varDecl.declarations[0].id.name),
		});
		return callControllerRemoved;
	}
}

