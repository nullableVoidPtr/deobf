import estraverse from 'estraverse';
import * as utils from '../../utils.js';
import { recoverStatements } from '../../ControlFlowAnalysis.js';

function analyseCases(cases, labelIdent, initLabel, endLabel) {
	let caseMap = {};
	for (let switchCase of cases) {
		if (switchCase.test === null ||
			switchCase.test.type !== 'Literal') {
			return null;
		}

		let statements = switchCase.consequent.slice(0);
		if (statements.length === 0) {
			return null;
		}

		let statementsBefore = [];
		let flowController = null;
		let statementsAfter = [];

		for (let i in statements) {
			if (utils.specMatch(statements[i], utils.parseStatement(`${labelIdent} = $_IGNORE_`))) {
				statementsBefore = statements.splice(0, i);
				flowController = statements.splice(0, 1)[0];
				statementsAfter = statements;

			}
		}

		if (flowController === null) {
			return null;
		}

		let consequent;
		let test = null;
		let alternate = null;
		if (flowController.expression.right.type === 'Literal') {
			consequent = flowController.expression.right.value;
		} else if (flowController.expression.right.type === 'ConditionalExpression') {
			test = flowController.expression.right.test;
			consequent = flowController.expression.right.consequent.value;
			alternate = flowController.expression.right.alternate.value;
		} else {
			return null;
		}

		let footer = statementsAfter.pop();
		if (!['BreakStatement', 'ContinueStatement', 'ReturnStatement'].includes(footer?.type)) {
			return null;
		} else if (footer.type === 'ContinueStatement' && footer.label === null) {
			return null;
		} else if (footer.type !== 'BreakStatement' || footer.label !== null) {
			statementsAfter.push(footer);
		}

		caseMap[switchCase.test.value] = {
			test,
			consequent,
			alternate,
			statementsBefore,
			statementsAfter,
		};
	}

	caseMap[endLabel] = {
		'consequent': null
	};
	return caseMap;
}

export const yargsOptions = {
		'control-flow-recovery-pass': {
			type: 'boolean',
			default: true,
			enabler: true,
		},
	}, repeatUntilStable = true;

export default tree => {
	let changed = false;
	estraverse.traverse(tree, {
		leave: (scope) => utils.modifyScope(scope,
			(varDecl, index, body) => {
				debugger;
				if (index === -1) {
					return;
				}

				let instructionPointerIdent = varDecl.declarations[0].id.name;
				let initLabel = varDecl.declarations[0].init.value;

				let parentLabel = null;
				let loop = body[index + 1];
				let statements = [loop];
				if (loop.type === 'BlockStatement') {
					statements = loop.body;
				}

				let recoveredStatements = [];
				let caseMap = null;
				let endLabel = null;
				for (let statement of statements) {
					debugger;
					if (statement.type === 'LabeledStatement' &&
						statement.body.type === 'WhileStatement') {
						parentLabel = statement.label;
						statement = statement.body;
					}
					if (!caseMap &&
						utils.specMatch(statement, {
							type: 'WhileStatement',
							test: utils.parseExpression(`${instructionPointerIdent} < $_Literal_`)
						})) {
						endLabel = statement.test.right.value;
						let cases;
						if (statement.body.type === 'SwitchStatement') {
							cases = statement.body.cases;
						} else if (statement.body.type === 'BlockStatement' &&
							statement.body.body.length === 1 &&
							statement.body.body[0].type === 'SwitchStatement') {
							cases = statement.body.body[0].cases;
						}
						caseMap = analyseCases(cases, instructionPointerIdent, initLabel, endLabel);
					} else {
						recoveredStatements.push(statement);
					}
				}

				if (!caseMap) {
					return;
				}

				let controlFlow = {
					nodes: caseMap,
					entry: initLabel,
					exit: endLabel,
				}
				if (!parentLabel) {
					recoveredStatements.push(...recoverStatements(controlFlow));
				} else {
					recoveredStatements.push({
						type: 'LabeledStatement',
						label: parentLabel,
						body: {
							type: 'BlockStatement',
							body: recoverStatements(controlFlow),
						},
					});
				}
				body.splice(index, 2, ...recoveredStatements);
				changed = true;
			},
			varDecl => utils.specMatch(varDecl, utils.parseStatement('var $_IGNORE_ = $_Literal_'))),
	});
	return changed;
};
