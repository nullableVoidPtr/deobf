import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function isDispatcher(statement, execOrderIdent) {
	return utils.specMatch(statement, utils.parseStatement(`
		while (true) {
			switch (${execOrderIdent}[$_Identifier_++]) {}}`))
		&& statement.body.body[0].cases.every((switchCase) => switchCase.test.type === 'Literal');
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
				let execOrderDecl;
				let setupIndex = decl.declarations.findIndex((declaration) => {
					if (!utils.specMatch(declaration.init, utils.parseExpression('$_Literal_.split("|")'))) {
						return false;
					}
					execOrderDecl = declaration;
					return true;
				});
				if (setupIndex === -1) {
					return;
				}
				let execOrderIdent = execOrderDecl.id.name;
				let execOrder = execOrderDecl.init.callee.object.value.split('|');
				//let execCounterIdent = execCounterDecl.id.name;

				let dispatcherIndex = body.findIndex((node, i) => i > setupIndex && isDispatcher(node, execOrderIdent));
				if (dispatcherIndex === -1) {
					return;
				}

				let dispatcher = body[dispatcherIndex];
				let switchCases = dispatcher.body.body[0].cases;
				let execCounterIdent = dispatcher.body.body[0].discriminant.property.argument.name;
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
			(node) => node.type === 'VariableDeclaration'),
	});
	utils.removeEmptyVarDecls(tree);
	return controlFlowRecovered;
};
