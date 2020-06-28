import estraverse from 'estraverse';
import utils from '../../utils.js';
import BasePass from '../BasePass.js';

export const yargsOptions = {
	'console-enable-pass': {
		type: 'boolean',
		default: true,
	},
};

export default class extends BasePass {
	static isEnabled(options) {
		return options.consoleEnablePass;
	}

	static _transform(tree, options) {
		let removed = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				if (!['BlockStatement', 'Program'].includes(scope.type) ||
					scope.body.length < 2) {
					return;
				}
				let consoleDisableIdent;
				let consoleDisableIndex = scope.body.findIndex((varDecl) => {
					if (!utils.specMatch(varDecl, utils.parseStatement('var $_IGNORE_ = $_Identifier_(this, $_FunctionExpression_)'))) {
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
							if (utils.specMatch(assign, utils.parseStatement('$_IGNORE_.console.$_Identifier_ = $_IGNORE_')) &&
								assign.expression.left.property.name in isAssigned) {
								isAssigned[assign.expression.left.property.name] = true;
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
				if (!utils.specMatch(scope.body[consoleDisableIndex + 1], utils.parseStatement(`${consoleDisableIdent}()`))) {
					return;
				}
				removed = true;
				scope.body.splice(consoleDisableIndex, 2);
				return estraverse.VisitorOption.Break;
			}
		});
		return removed;
	}
}
