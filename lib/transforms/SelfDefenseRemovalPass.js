const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isSelfDefense(decl) {
}

module.exports = class SelfDefenseRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'self-defense-removal-pass': {
				type: 'boolean',
				default: true,
			},
		};
	}

	static isEnabled(options) {
		return options.selfDefenseRemovalPass;
	}

	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		let selfDefenseRemoved = false;
		estraverse.replace(tree, {
			enter: (scope) => {
				if (scope.type === 'BlockStatement' &&
					scope.body.length >= 2) {
					let selfDefenseIndex = scope.body.findIndex((varDecl) => {
						if (!utils.specMatch(varDecl, {
							type: 'VariableDeclaration',
							declarations: [{
								type: 'VariableDeclarator',
								init: {
									type: 'CallExpression',
									callee: {
										type: 'Identifier',
									},
									arguments: [{
										type: 'ThisExpression'
									}, {
										type: 'FunctionExpression',
									}],
								}
							}],
						})) {
							return false;
						}
						let innerFunc = varDecl.declarations[0].init.arguments[1];
						let hasRegex = false
						estraverse.traverse(innerFunc, {
							enter: (statement) => {
								if (utils.specMatch(statement, {
									type: 'CallExpression',
									callee: {
										type: 'MemberExpression',
										object: {
											type: 'CallExpression',
											callee: {
												type: 'CallExpression',
												callee: {
													type: 'MemberExpression',
													object: {
														type: 'Identifier'
													},
													property: {
														type: 'Identifier',
														name: 'constructor'
													}
												},
												arguments: [{
													type: 'Literal',
													value: 'return /" + this + "/',
												}],
											},
										},
										property: {
											type: 'Identifier',
											name: 'compile'
										}
									},
									arguments: [{
										type: 'Literal',
										value: '^([^ ]+( +[^ ]+)+)+[^ ]}',
									}],
								})) {
									hasRegex = true;
									return estraverse.VisitorOption.Break;
								}
							},
						});
						return hasRegex;
					});
	
					if (selfDefenseIndex === -1) {
						return;
					}

					let selfDefenseIdent = scope.body[selfDefenseIndex].declarations[0].id.name;
					scope.body.splice(selfDefenseIndex, 1);
					estraverse.replace(scope, {
						enter: (call) => {
							if (utils.specMatch(call, {
								type: 'ExpressionStatement',
								expression: {
									type: 'CallExpression',
									callee: {
										type: 'Identifier',
										name: selfDefenseIdent,
									},
								}
							})) {
								return estraverse.VisitorOption.Remove;
							}
						}
					});
					selfDefenseRemoved = true;
					return scope;
				}
			}
		});
		return selfDefenseRemoved;
	}
}


