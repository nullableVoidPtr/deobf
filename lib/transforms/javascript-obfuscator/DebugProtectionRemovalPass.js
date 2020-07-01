import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function isInnerProtFunc(decl) {
	if (!(decl.type === 'FunctionDeclaration' &&
		decl.params.length === 1)) {
		return;
	}

	let counterIdent = decl.params[0].name;

	let body = decl.body.body;
	if (body.length !== 2) {
		return false;
	}
	if (!utils.specMatch(body[1], utils.parseStatement(`${utils.escapeIdentifier(decl.id.name)}(++${utils.escapeIdentifier(counterIdent)})`))) {
		return false;
	}

	if (!utils.specMatch(body[0], {
		type: 'IfStatement',
		test: utils.parseExpression(`typeof ${utils.escapeIdentifier(counterIdent)} === 'string'`),
		alternate: {
			type: 'BlockStatement',
			body: [{
				type: 'IfStatement',
				test: utils.parseExpression(`('' + ${utils.escapeIdentifier(counterIdent)} / ${utils.escapeIdentifier(counterIdent)}).length !== 1 || ${utils.escapeIdentifier(counterIdent)} % 20 === 0`),
			}],
		},
	})) {
		return false;
	}
	return true;
}

function isOuterProtFunc(decl) {
	if (!(decl.type === 'FunctionDeclaration' &&
		decl.params.length === 1 &&
		decl.body.body.length === 2)) {
		return false;
	}
	let [innerFuncDecl, tryStatement] = decl.body.body;
	let outerFuncParamIdent = decl.params[0].name;

	if (!isInnerProtFunc(innerFuncDecl)) {
		return false;
	}
	let innerFuncIdent = innerFuncDecl.id.name;

	if (!(tryStatement.type === 'TryStatement' &&
		tryStatement.block.body.length === 1 &&
		tryStatement.handler.body.body.length === 0
	)) {
		return false;
	}
	if (!(utils.specMatch(tryStatement.block.body[0], {
		type: 'IfStatement',
		test: {
			type: 'Identifier',
			name: outerFuncParamIdent,
		},
	}))) {
		return false;
	}
	let outerIfStatement = tryStatement.block.body[0];

	if (!(outerIfStatement.consequent === null ||
		outerIfStatement.consequent.type === 'BlockStatement' ||
		outerIfStatement.consequent.body.length === 1)) {
		return false;
	}
	if (!utils.specMatch(outerIfStatement.consequent.body[0], {
		type: 'ReturnStatement',
		argument: {
			type: 'Identifier',
			name: innerFuncIdent,
		}
	})) {
		return false;
	}
	if (!(outerIfStatement.alternate === null ||
		outerIfStatement.alternate.type === 'BlockStatement' ||
		outerIfStatement.alternate.body.length === 1)) {
		return false;
	}
	if (!utils.specMatch(outerIfStatement.alternate.body[0], utils.parseStatement(`${utils.escapeIdentifier(innerFuncIdent)}(0)`))) {
		return false;
	}
	return true;
}

export const yargsOptions = {
	'debug-protection-removal-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
	'debug-protection-function': {
		type: 'string',
	},
};

export default (tree, options) => {
	let debugProtIdent = null;
	if (typeof options.debugProtectionFunction === 'undefined') {
		estraverse.traverse(tree, {
			enter: (outerFuncDecl) => {
				if (isOuterProtFunc(outerFuncDecl)) {
					debugProtIdent = outerFuncDecl.id.name;
					return estraverse.VisitorOption.Break;
				}
			}
		});
	} else {
		debugProtIdent = options.debugProtectionFunction;
	}

	if (debugProtIdent === null) {
		return false;
	}
	estraverse.replace(tree, {
		enter: (node) => {
			if ((node.type === 'ExpressionStatement' &&
				node.expression.type === 'CallExpression')) {
				if (utils.specMatch(node.expression,
					utils.parseExpression(`setInterval(function(){${utils.escapeIdentifier(debugProtIdent)}()}, 4000)`))) {
					return estraverse.VisitorOption.Remove;
				}
				let callFound = false;
				if (utils.specMatch(node.expression.callee,
					utils.parseExpression('(function(){$_Identifier_(this, $_FunctionExpression_)()})'))) {
					estraverse.traverse(node.expression.callee.body.body[0].expression.callee.arguments[1], {
						enter: (call) => {
							if (utils.specMatch(call, utils.parseExpression(`${utils.escapeIdentifier(debugProtIdent)}()`))) {
								callFound = true;
								return estraverse.VisitorOption.Break;
							}
						}
					});
				}
				if (callFound) {
					return estraverse.VisitorOption.Remove;
				}
			} else if (node.type === 'FunctionDeclaration' &&
				node.id.name === debugProtIdent &&
				isOuterProtFunc(node)) {
				return estraverse.VisitorOption.Remove;
			}
		}
	});
	return true;
};
