import estraverse from 'estraverse';
import * as utils from '../../utils.js';

export const yargsOptions = {
	'console-enable-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
};

function isConsoleDisable(decl) {
	if (!utils.specMatch(decl.init, utils.parseExpression('$_Identifier_(this, $_FunctionExpression_)'))) {
		return false;
	}
	let innerFunc = decl.init.arguments[1];
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
	return true;
}

export default tree => {
	let removed = false;
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(scope,
			(decl, index, body) => {
				if (index === -1) {
					return;
				}
				let consoleDisableIndex = decl.declarations.findIndex((declaration) => {
					if (!isConsoleDisable(declaration)) {
						return;
					}
					let consoleDisableIdent = declaration.id.name;
					return utils.specMatch(body[index + 1], utils.parseStatement(`${utils.escapeIdentifier(consoleDisableIdent)}()`));
				});
				if (consoleDisableIndex !== -1) {
					removed = true;
					decl.declarations.splice(consoleDisableIndex, 1);
					body.splice(index + 1, 1);
				}
			},
			(node) => node.type === 'VariableDeclaration'),
	});
	return removed;
};
