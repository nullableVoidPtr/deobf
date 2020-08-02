import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function isCallController(decl) {
	if (!utils.specMatch(decl.init, utils.parseExpression('$_FunctionExpression_()'))) {
		return false;
	}
	let iife = decl.init.callee;

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

	let found = false;
	estraverse.traverse(returnStatement.argument, {
		enter(ternary) {
			if (utils.specMatch(ternary, {
				type: 'VariableDeclarator',
				init: utils.parseExpression('($_Identifier_) ? $_FunctionExpression_ : $_FunctionExpression_')
			})) {
				found = true;
				return estraverse.VisitorOption.Break;
			}
		}
	});
	return found;
}

export const yargsOptions = {
		'call-controller-removal-pass': {
			type: 'boolean',
			default: true,
			enabler: true,
		},
	}, repeatUntilStable = true;

export default tree => {
	let callControllerRemoved = false;
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(scope,
			(decl, index) => {
				if (index === -1) {
					return;
				}
				let callControllerIndex = decl.declarations.findIndex((declaration) => {
					if (!isCallController(declaration)) {
						return;
					}
					let callControllerIdent = declaration.id.name;
					let isCalled = false;
					estraverse.traverse(scope, {
						enter: (call) => {
							if (utils.specMatch(call, utils.parseExpression(`${callControllerIdent}()`))) {
								isCalled = true;
								return estraverse.VisitorOption.Break;
							}
						}
					});
					return !isCalled;
				});
				if (callControllerIndex !== -1) {
					callControllerRemoved = true;
					decl.declarations.splice(callControllerIndex, 1);
				}
			},
			(node) => node.type === 'VariableDeclaration'),
	});
	utils.removeEmptyVarDecls(tree);
	return callControllerRemoved;
};
