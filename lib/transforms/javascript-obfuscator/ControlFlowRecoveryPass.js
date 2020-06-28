import estraverse from 'estraverse';
import utils from '../../utils.js';

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
	},
}, isEnabled = (options) => options.controlFlowRecoveryPass;

export default (tree) => {
	let controlFlowRecovered = false;
	estraverse.traverse(tree, {
		enter: (scope) => {
			if (scope.type !== 'BlockStatement' ||
				scope.body.length < 2) {
				return;
			}
			let varDeclIndex = scope.body.findIndex((varDecl) =>
				utils.specMatch(varDecl, utils.parseStatement(`
						var $_IGNORE_ = $_Literal_.split("|"),
							$_IGNORE_ = 0;`)));

			if (varDeclIndex === -1 ||
				varDeclIndex === scope.body.length - 1) {
				return;
			}

			let [execOrderDecl, execCounterDecl] = scope.body[varDeclIndex].declarations;
			let execOrderIdent = execOrderDecl.id.name;
			let execOrder = execOrderDecl.init.callee.object.value.split('|');
			let execCounterIdent = execCounterDecl.id.name;

			if (!isDispatcher(scope.body[varDeclIndex + 1],
				execOrderIdent, execCounterIdent)) {
				return;
			}

			let switchCases = scope.body[varDeclIndex + 1].body.body[0].cases;
			let caseMap = Object.fromEntries(switchCases.map((switchCase) => {
				let consequent = switchCase.consequent;
				if (consequent[consequent.length - 1].type === 'ContinueStatement') {
					consequent = consequent.slice(0, consequent.length - 1);
				}
				return [switchCase.test.value, consequent];
			}));
			let orderedStatements = execOrder.flatMap((n) => caseMap[n]);
			scope.body.splice(varDeclIndex, 2, ...orderedStatements);
			controlFlowRecovered = true;
		}
	});
	utils.removeEmptyVarDecls(tree);
	return controlFlowRecovered;
}
