const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

function isDomainLock(decl) {
	if (!utils.specMatch(decl, {
		type: 'VariableDeclaration',
		declarations: [{
			type: 'VariableDeclarator',
			init: utils.parseExpression('$_Identifier_(this, $_FunctionExpression_)'),
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
				init: utils.parseExpression(`new RegExp($_Literal_, 'g')`),
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
			init: utils.parseExpression(`$_Literal_.replace(${utils.escapeIdentifier(diffRegex.id.name)}, '').split(';')`),
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
					let domainLockIndex = scope.body.findIndex(isDomainLock);
					if (domainLockIndex === -1) {
						return;
					}

					let domainLockIdent = scope.body[domainLockIndex].declarations[0].id.name;
					scope.body.splice(domainLockIndex, 1);
					estraverse.replace(scope, {
						enter: (call) => {
							if (utils.specMatch(call, utils.parseStatement(`${utils.escapeIdentifier(domainLockIdent)}()`))) {
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


