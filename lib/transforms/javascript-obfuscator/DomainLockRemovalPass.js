import estraverse from 'estraverse';
import * as utils from '../../utils.js';

const domainLockSignatures = [
	(innerFunc) => {
		let diffRegex = null;
		estraverse.traverse(innerFunc, {
			enter(decl) {
				if (utils.specMatch(decl, {
					type: 'VariableDeclarator',
					init: utils.parseExpression('new RegExp($_Literal_, "g")')
				})) {
					diffRegex = decl;
					return estraverse.VisitorOption.Break;
				}
			},
		});
		if (!diffRegex) {
			return false;
		}
		let domains = null;
		estraverse.traverse(innerFunc, {
			enter(decl) {
				if (utils.specMatch(decl, {
					type: 'VariableDeclarator',
					init: utils.parseExpression(`$_Literal_.replace(${utils.escapeIdentifier(diffRegex.id.name)}, '').split(';')`)
				})) {
					let obfuscatedDomains = decl.init.callee.object.callee.object.value;
					domains = obfuscatedDomains.replace(new RegExp(diffRegex.init.arguments[0].value, 'g'), '').split(';');
					return estraverse.VisitorOption.Break;
				}
			}
		})
		if (domains !== null) {
			console.error('Domain lock:');
			console.error(domains.join('\n'));
			return true;
		}
	},
	(innerFunc) => {
		let freezerFound = false;
		estraverse.traverse(innerFunc.body, {
			enter(node) {
				if (utils.specMatch(node, utils.parseStatement('for (var $_IGNORE_ = 0; $_IGNORE_ < 1000; $_IGNORE_--) {}'))) {
					freezerFound = true;
					return estraverse.VisitorOption.Break;
				}
			}
		});
		return freezerFound;
	}
];

function isDomainLock(decl) {
	if (!utils.specMatch(decl.init, utils.parseExpression('$_Identifier_(this, $_FunctionExpression_)'))) {
		return false;
	}
	let innerFunc = decl.init.arguments[1];

	return domainLockSignatures.some(signature => signature(innerFunc));
}

export const yargsOptions = {
	'domain-lock-removal-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
};

export default tree => {
	let removed = false;
	estraverse.replace(tree, {
		enter: (scope) => utils.modifyScope(scope,
			(decl, index, body) => {
				if (index === -1) {
					return;
				}
				let domainLockIndex = decl.declarations.findIndex((declaration) => {
					if (!isDomainLock(declaration)) {
						return;
					}
					let domainLockIdent= declaration.id.name;
					return utils.specMatch(body[index + 1], utils.parseStatement(`${utils.escapeIdentifier(domainLockIdent)}()`));
				});
				if (domainLockIndex !== -1) {
					removed = true;
					decl.declarations.splice(domainLockIndex, 1);
					body.splice(index + 1, 1);
				}
			},
			(node) => node.type === 'VariableDeclaration'),
	});
	utils.removeEmptyVarDecls(tree);
	return removed;
};
