const BasePass = require('./../BasePass.js');
const estraverse = require('estraverse');
const utils = require('../../utils.js')

function isSelfDefense(decl) {
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
	let hasRegex = false
	estraverse.traverse(innerFunc, {
		enter: (statement) => {
			if (utils.specMatch(statement, utils.parseExpression(`$_Identifier_.constructor('return /" + this + "/')().compile('^([^ ]+( +[^ ]+)+)+[^ ]}')`))) {
				hasRegex = true;
				return estraverse.VisitorOption.Break;
			}
		},
	});
	return hasRegex;
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
				if (['Program', 'BlockStatement'].indexOf(scope.type) !== -1 &&
					scope.body.length >= 2) {
					let selfDefenseIndex = scope.body.findIndex(isSelfDefense);
					if (selfDefenseIndex === -1) {
						return;
					}

					let selfDefenseIdent = scope.body[selfDefenseIndex].declarations[0].id.name;
					if (!utils.specMatch(scope.body[selfDefenseIndex + 1], utils.parseStatement(`${utils.escapeIdentifier(selfDefenseIdent)}()`))) {
						return;
					}
					scope.body.splice(selfDefenseIndex, 2);
					selfDefenseRemoved = true;
				}
			}
		});
		return selfDefenseRemoved;
	}
}

