const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

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
	if (!utils.specMatch(body[1], {
		type: 'ExpressionStatement',
		expression: {
			type: 'CallExpression',
			callee: {
				type: 'Identifier',
				name: decl.id.name,
			},
			arguments: [{
				type: 'UpdateExpression',
				operator: '++',
				argument: {
					type: 'Identifier',
					name: counterIdent,
				}
			}],
		}
	})) {
		return false;
	}

	if (!utils.specMatch(body[0], {
		type: 'IfStatement',
		test: {
			type: 'BinaryExpression',
			operator: '===',
			left: {
				type: 'UnaryExpression',
				operator: 'typeof',
				argument: {
					type: 'Identifier',
					name: counterIdent,
				}
			},
			right: {
				type: 'Literal',
				value: 'string',
			},
		},
		alternate: {
			type: 'BlockStatement',
			body: [{
				type: 'IfStatement',
				test: {
					type: 'LogicalExpression',
					operator: '||',
					left: {
						type: 'BinaryExpression',
						operator: '!==',
						left: {
							type: 'MemberExpression',
							computed: true,
							object: {
								type: 'BinaryExpression',
								operator: '+',
								left: {
									type: 'Literal',
									value: ''
								},
								right: {
									type: 'BinaryExpression',
									operator: '/',
									left: {
										type: 'Identifier',
										name: counterIdent,
									},
									right: {
										type: 'Identifier',
										name: counterIdent,
									},
								}
							},
							property: {
								type: 'Literal',
								value: 'length',
							},
						},
						right: {
							type: 'Literal',
							value: 1,
						},
					},
					right: {
						type: 'BinaryExpression',
						operator: '===',
						left: {
							type: 'BinaryExpression',
							operator: '%',
							left: {
								type: 'Identifier',
								name: counterIdent,
							},
							right: {
								type: 'Literal',
								value: 20,
							},
						},
						right: {
							type: 'Literal',
							value: 0
						},
					}
				}

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
	if (!utils.specMatch(outerIfStatement.alternate.body[0], {
		type: 'ExpressionStatement',
		expression: {
			type: 'CallExpression',
			callee: {
				type: 'Identifier',
				name: innerFuncIdent,
			},
			arguments: [{
				type: 'Literal',
				value: 0,
			}],
		}
	})) {
		return false;
	}
	return true;
}

module.exports = class DebugProtectionRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'debug-protection-removal-pass': {
				type: 'boolean',
				default: true,
			},
			'debug-protection-function': {
				type: 'string',
			},
		};
	}

	static isEnabled(options) {
		return options.debugProtectionRemovalPass;
	}

	static _transform(tree, options) {
		let debugProtIdent;
		if (typeof options.debugProtectionFunction === 'undefined') {
			estraverse.traverse(tree, {
				enter: (outerFuncDecl) => {
					if (isOuterProtFunc(outerFuncDecl)) {
						debugProtIdent = outerFuncDecl.id.name;
						return estraverse.VisitorOption.Break;
					}
				}
			})
		} else {
			debugProtIdent = options.debugProtectionFunction;  
		}

		if (typeof debugProtIdent === 'undefined') {
			return false;
		}
		estraverse.replace(tree, {
			enter: (node) => {
				if ((node.type === 'ExpressionStatement' &&
					node.expression.type === 'CallExpression')) {
					if (utils.specMatch(node.expression, {
						type: 'CallExpression',
						callee: {
							type: 'Identifier',
							name: 'setInterval',
						},
						arguments: [{
							type: 'FunctionExpression',
							params: [],
							body: {
								type: 'BlockStatement',
								body: [
									{
										type: 'ExpressionStatement',
										expression: {
											type: 'CallExpression',
											callee: {
												type: 'Identifier',
												name: debugProtIdent,
											},
										}
									},
								]
							},
						}, {
							type: 'Literal',
							value: 4000,
						}]
					})) {
						return estraverse.VisitorOption.Remove;
					}
					let callFound = false;
					if (utils.specMatch(node.expression.callee, {
						type: 'CallExpression',
						callee: {
							type: 'Identifier'
						},
						arguments: [{
							type: 'ThisExpression'
						}, {
							type: 'FunctionExpression',
						}]
					})) {
						estraverse.traverse(node.expression.callee.arguments[1], {
							enter: (call) => {
								if (utils.specMatch(call, {
									type: 'CallExpression',
									callee: {
										type: 'Identifier',
										name: debugProtIdent,
									},
								})) {
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
	}
}
