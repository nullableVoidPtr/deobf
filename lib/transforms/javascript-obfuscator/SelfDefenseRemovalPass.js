import estraverse from 'estraverse';
import utils from '../../utils.js';
import BasePass from '../BasePass.js';

function isSelfDefense(decl) {
	if (!utils.specMatch(decl, utils.parseStatement('var $_IGNORE_ = $_Identifier_(this, $_FunctionExpression_)'))) {
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


export default class extends BasePass {
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
				if (['Program', 'BlockStatement'].includes(scope.type) &&
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


