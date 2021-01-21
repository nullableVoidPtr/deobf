import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function extractCounterFromDispatcher(statement, execOrderIdent) {
	let matches = utils.specMatch(statement, utils.parseStatement(`
		while (true) {
			switch (${execOrderIdent}[$_Identifier$1_++]) {}}`));
	if (!(matches && statement.body.body[0].cases.every((switchCase) => switchCase.test.type === 'Literal'))) {
		return null;
	}
	return matches[1];
}

export const yargsOptions = {
	'control-flow-recovery-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
};

export default tree => {
	let controlFlowRecovered = false;
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(scope,
			(decl, index, body) => {
				if (index === -1) {
					return;
				}
				let execOrder, execOrderIdent;
				let setupIndex = decl.declarations.findIndex((declaration) => {
					let matches = utils.specMatch(declaration.init, utils.parseExpression('$_Literal$1_.split("|")'));
					if (!matches) {
						return false;
					}
					execOrder = matches[1].value.split('|');
					execOrderIdent = declaration.id.name;
					return true;
				});
				if (setupIndex === -1) {
					return;
				}

				let execCounterIdent;
				let dispatcherIndex = body.findIndex((node, i) => i > setupIndex && (execCounterIdent = extractCounterFromDispatcher(node, execOrderIdent)));
				if (dispatcherIndex === -1) {
					return;
				}

				let dispatcher = body[dispatcherIndex];
				let switchCases = dispatcher.body.body[0].cases;
				let caseMap = Object.fromEntries(switchCases.map((switchCase) => {
					let consequent = switchCase.consequent;
					if (consequent[consequent.length - 1].type === 'ContinueStatement') {
						consequent = consequent.slice(0, consequent.length - 1);
					}
					return [switchCase.test.value, consequent];
				}));
				let orderedStatements = execOrder.flatMap((n) => caseMap[n]);
				decl.declarations.splice(setupIndex, 1);
				body.splice(dispatcherIndex, 1, ...orderedStatements);
				for (let i = 0; i < dispatcherIndex; i++) {
					if (body[i].type == 'VariableDeclaration') {
						if (body[i].declarations.map(d => d.id.name).includes(execCounterIdent)) {
							body[i].declarations = body[i].declarations.filter(d => d.id.name != execCounterIdent);
							break;
						}
					}
				}
				controlFlowRecovered = true;
			},
			(node) => node.type === 'VariableDeclaration' &&
				node.declarations.some(d => utils.specMatch(d.init, utils.parseExpression('$_Literal_.split("|")'))),
			(node) => node.declarations.map(d => d.id.name)
		),
	});
	utils.removeEmptyVarDecls(tree);
	return controlFlowRecovered;
};
