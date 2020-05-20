const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isDomainLock(decl) {
	if (!utils.specMatch(decl, {
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
	let innerFunc = decl.declarations[0].init.arguments[1];

	let diffRegexIndex = innerFunc.body.body.findIndex((statement) => 
		utils.specMatch(statement, {
			type: 'VariableDeclaration',
			declarations: [{
				type: 'VariableDeclarator',
				init: {
					type: 'NewExpression',
					callee: {
						type: 'Identifier',
						name: 'RegExp',
					},
					arguments: [{
						type: 'Literal',
					}, {
						type: 'Literal',
						value: 'g',
					}],
				},
			}],
		}));
	if (diffRegexIndex === -1 || diffRegexIndex === innerFunc.body.body.length - 1) {
		return false;
	}
	let diffRegex = innerFunc.body.body[diffRegexIndex].declarations[0];
	let hasDomainReplace = utils.specMatch(innerFunc.body.body[diffRegexIndex + 1], {
		type: 'VariableDeclaration',
		declarations: [{
			type: 'VariableDeclarator',
			init: {
				type: 'CallExpression',
				callee: {
					type: 'MemberExpression',
					object: {
						type: 'CallExpression',
						callee: {
							type: 'MemberExpression',
							computed: false,
							object: {
								type: 'Literal',
							},
							property: { type: 'Identifier', name: 'replace' }
						},
						arguments: [{
							type: 'Identifier',
							name: diffRegex.id.name
						}, {
							type: 'Literal',
							value: ''
						}],
					},
					property: {
						type: 'Identifier',
						name: 'split',
					},
				},
				arguments: [{
					type: 'Literal',
					value: ';'
				}],
			}
		}],
	});
	if (hasDomainReplace) {
		let domainRegex = innerFunc.body.body[diffRegexIndex + 1].declarations[0];
		let diff = new RegExp(diffRegex.init.arguments[0].value, 'g');
		let obfuscatedDomains = domainRegex.init.callee.object.callee.object.value;
		let domains = obfuscatedDomains.replace(diff, '').split(';');
		console.error('Domain lock:');
		console.error(domains.join('\n'));
		return true;
	}
}

module.exports = class DomainLockRemovalPass extends BasePass {
	static get yargsOptions() {
		return {
			'domain-lock-removal-pass': {
				type: 'boolean',
				default: true,
			},
		};
	}

	static isEnabled(options) {
		return options.domainLockRemovalPass;
	}

	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		let removed = false;
		estraverse.replace(tree, {
			enter: (scope) => {
				if (['Program', 'BlockStatement'].indexOf(scope.type) !== -1 &&
					scope.body.length >= 2) {
					let DomainLockIndex = scope.body.findIndex(isDomainLock);
					if (DomainLockIndex === -1) {
						return;
					}

					let selfDefenseIdent = scope.body[DomainLockIndex].declarations[0].id.name;
					scope.body.splice(DomainLockIndex, 1);
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
					removed = true;
				}
			}
		});
		return removed;
	}
}


