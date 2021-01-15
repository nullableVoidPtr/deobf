import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function isSelfDefense(decl) {
	if (!utils.specMatch(decl.init, utils.parseExpression('$_Identifier_(this, $_FunctionExpression_)'))) {
		return false;
	}
	let innerFunc = decl.init.arguments[1];
	let hasRegex = false;
	estraverse.traverse(innerFunc, {
		enter: (statement) => {
			if (utils.specMatch(statement, utils.parseExpression(
				'$_Identifier_.constructor(\'return /" + this + "/\')().constructor($_IGNORE_)'))) {
				hasRegex = true;
				return estraverse.VisitorOption.Break;
			}
		},
	});
	return hasRegex;
}

export const yargsOptions = {
		'self-defense-removal-pass': {
			type: 'boolean',
			default: true,
			enabler: true,
		},
	}, repeatUntilStable = true;

export default tree => {
	let selfDefenseRemoved = false;
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(scope,
			(decl, index, body) => {
				if (index === -1) {
					return;
				}
				let selfDefenseIndex = decl.declarations.findIndex((declaration) => {
					if (!isSelfDefense(declaration)) {
						return;
					}
					let selfDefenseIdent = declaration.id.name;
					return utils.specMatch(body[index + 1], utils.parseStatement(`${utils.escapeIdentifier(selfDefenseIdent)}()`));
				});
				if (selfDefenseIndex !== -1) {
					selfDefenseRemoved = true;
					decl.declarations.splice(selfDefenseIndex, 1);
					body.splice(index + 1, 1);
				}
			},
			(node) => node.type === 'VariableDeclaration'),
	});
	utils.removeEmptyVarDecls(tree);
	return selfDefenseRemoved;
};
