const BasePass = require('./../BasePass.js');
const estraverse = require('estraverse');
const utils = require('../../utils.js')

function isDomainLock(decl) {
	if (!utils.specMatch(decl, utils.parseStatement('var $_IGNORE_ = $_Identifier_(this, $_FunctionExpression_)'))) {
		return false;
	}
	let innerFunc = decl.declarations[0].init.arguments[1];

	let diffRegexIndex = innerFunc.body.body.findIndex((statement) => 
		utils.specMatch(statement, utils.parseStatement('var $_IGNORE_ = new RegExp($_Literal_, "g")')));
	if (diffRegexIndex === -1 || diffRegexIndex === innerFunc.body.body.length - 1) {
		return false;
	}
	let diffRegex = innerFunc.body.body[diffRegexIndex].declarations[0];
	if (utils.specMatch(innerFunc.body.body[diffRegexIndex + 1],
		utils.parseStatement(`var $_IGNORE_ = $_Literal_.replace(${utils.escapeIdentifier(diffRegex.id.name)}, '').split(';')`))) {
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

	static _transform(tree, options) {
		let removed = false;
		estraverse.replace(tree, {
			enter: (scope) => {
				if (['Program', 'BlockStatement'].includes(scope.type) &&
					scope.body.length >= 2) {
					let domainLockIndex = scope.body.findIndex(isDomainLock);
					if (domainLockIndex === -1) {
						return;
					}

					let domainLockIdent = scope.body[domainLockIndex].declarations[0].id.name;
					if (!utils.specMatch(scope.body[domainLockIndex + 1], utils.parseStatement(`${utils.escapeIdentifier(domainLockIdent)}()`))) {
						return;
					}
					scope.body.splice(domainLockIndex, 2);
					removed = true;
				}
			}
		});
		return removed;
	}
}


