import estraverse from 'estraverse';
import utils from '../../utils.js';

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

export const yargsOptions = {
	'call-controller-removal-pass': {
		type: 'boolean',
		default: true,
	},
}, repeatUntilStable = true, isEnabled = (options) => options.callControllerRemovalPass;

export default (tree, options) => {
	let callControllerRemoved = false;
	estraverse.traverse(tree, {
		enter: scope => utils.modifyScope(scope,
			(callController, index, body) => {
				if (index === -1) {
					return;
				}

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
			isCallController),
	});
	return callControllerRemoved;
}
