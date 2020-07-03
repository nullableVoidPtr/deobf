import estraverse from 'estraverse';
import * as utils from '../../utils.js';
import { recoverStatements } from '../../ControlFlowAnalysis.js';

function analyseCases(cases, labelIdent) {
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

		let header = statements.shift();
		if (!utils.specMatch(header, utils.parseStatement(`${labelIdent} = $_IGNORE_`))) {
			return null;
		}
		let consequent;
		let test = null;
		let alternate = null;
		if (header.expression.right.type === 'Literal') {
			consequent = header.expression.right.value;
		} else if (header.expression.right.type === 'ConditionalExpression') {
			test = header.expression.right.test;
			consequent = header.expression.right.consequent.value;
			alternate = header.expression.right.alternate.value;
		} else {
			return null;
		}

		let footer = statements.pop();
		if (!['BreakStatement', 'ContinueStatement', 'ReturnStatement'].includes(footer?.type)) {
			return null;
		} else if (footer.type === 'ContinueStatement' && footer.label === null) {
			return null;
		} else if (footer.type !== 'BreakStatement' || footer.label !== null) {
			statements.push(footer);
		}

		caseMap[switchCase.test.value] = {
			test,
			consequent,
			alternate,
			statements,
		};
	}
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
				} else if (loop.type === 'LabeledStatement') {
					parentLabel = loop.label;
					statements = [loop.body];
				}

				let recoveredStatements = [];
				let caseMap = null;
				let endLabel = null;
				for (let statement of statements) {
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

				recoveredStatements.push(...recoverStatements(caseMap, initLabel, endLabel));
				if (parentLabel) {
					recoveredStatements[0] = {
						type: 'LabeledStatement',
						label: parentLabel,
						body: recoveredStatements[0],
					};
				}
				body.splice(index, 2, ...recoveredStatements);
				changed = true;
			},
			varDecl => utils.specMatch(varDecl, utils.parseStatement('var $_IGNORE_ = $_Literal_'))),
	});
	return changed;
};
