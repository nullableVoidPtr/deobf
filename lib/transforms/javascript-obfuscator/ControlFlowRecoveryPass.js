import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function isDispatcher(statement, execOrderIdent, execCounterIdent) {
	return utils.specMatch(statement, utils.parseStatement(`
		while (true) {
			switch (${execOrderIdent}[${execCounterIdent}++]) {}}`))
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
				let execOrderDecl, execCounterDecl;
				let setupIndex = decl.declarations.findIndex((declaration, declIndex, declarations) => {
					if (!utils.specMatch(declaration.init, utils.parseExpression('$_Literal_.split("|")'))) {
						return false;
					}
					execOrderDecl = declaration;
					let next = declarations[declIndex + 1];
					if (utils.specMatch(next?.init, utils.parseExpression('0'))) {
						execCounterDecl = next;
						return true;
					}
				});
				if (setupIndex === -1) {
					return;
				}
				let execOrderIdent = execOrderDecl.id.name;
				let execOrder = execOrderDecl.init.callee.object.value.split('|');
				let execCounterIdent = execCounterDecl.id.name;

				let dispatcher = body[setupIndex + 1];
				if (!isDispatcher(dispatcher, execOrderIdent, execCounterIdent)) {
					return;
				}

				let switchCases = dispatcher.body.body[0].cases;
				let caseMap = Object.fromEntries(switchCases.map((switchCase) => {
					let consequent = switchCase.consequent;
					if (consequent[consequent.length - 1].type === 'ContinueStatement') {
						consequent = consequent.slice(0, consequent.length - 1);
					}
					return [switchCase.test.value, consequent];
				}));
				let orderedStatements = execOrder.flatMap((n) => caseMap[n]);
				decl.declarations.splice(setupIndex, 2);
				body.splice(index + 1, 1, ...orderedStatements);
				controlFlowRecovered = true;
			},
			(node) => node.type === 'VariableDeclaration'),
	});
	utils.removeEmptyVarDecls(tree);
	return controlFlowRecovered;
};
