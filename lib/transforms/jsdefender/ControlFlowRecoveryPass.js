const BasePass = require('./../BasePass.js');
const utils = require('../../utils.js');
const estraverse = require('estraverse');

const ScopeBodyMap = {
	'BlockStatement': 'body',
	'Program': 'body',
	'SwitchCase': 'consequent',
};

function analysePredecessors(caseMap, current, endLabel, visited = []) {
	if (current !== endLabel) {
		visited.push(current);
		let successors = [caseMap[current].consequent];
		if ('test' in caseMap[current]) {
			successors.push(caseMap[current].alternate);
		}

		for (let successor of adjacents) {
			if (caseMap[successor].predecessor.indexOf(current) === -1) {
				caseMap[successor].predecessor.push(current);
			}
			if (visited.indexOf(successor) === -1) {
				analysePredecessors(caseMap, successor, endLabel, visited)
			}
		}
	}
}

function getDominatorTree(caseMap, current, endLabel) {

}

function recoverStatements(caseMap, initLabel, endLabel) {
	let dominant = {};
	for (caseMap)
	let changed;
	do {
		changed = false;
	} while (changed);
	//TODO do whiles and for loops
	//let statements = [];
	//while (current !== endLabel) {
	//	if ('test' in caseMap[current]) {
	//		let consequent = generateAcyclic(caseMap, caseMap[current].consequent, endLabel);
	//		let alternate = generateAcyclic(caseMap, caseMap[current].alternate, endLabel);
	//		let prologue = [];
	//		if (consequent.length !== 0 && alternate.length !== 0) {
	//			while (consequent[consequent.length - 1].caseLabel === alternate[alternate.length - 1].caseLabel) {
	//				consequent.pop();
	//				prologue.push(alternate.pop());
	//			}
	//		}

	//		let consequentBlock = {
	//			type: 'BlockStatement',
	//			body: consequent,
	//		};
	//		let alternateBlock = (alternate.length > 0) ? {
	//			type: 'BlockStatement',
	//			body: alternate,
	//		} : null;
	//		statements.push({
	//			type: 'IfStatement',
	//			caseLabel: current,
	//			test: caseMap[current].test,
	//			consequent: consequentBlock,
	//			alternate: alternateBlock,
	//		});
	//		statements.push(...prologue);
	//		break;
	//	} else {
	//		for (let statement of caseMap[current].statements) {
	//			statement.caseLabel = current;
	//			statements.push(statement);
	//		}
	//		current = caseMap[current].consequent
	//	}
	//};
	//return statements;
	return null
}

module.exports = class ControlFlowRecoveryPass extends BasePass {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		estraverse.traverse(tree, {
			leave(scope) {
				if (!(scope.type in ScopeBodyMap)) {
					return;
				}
				let body = scope[ScopeBodyMap[scope.type]];
				let cases;
				let endLabel;
				let instructionPointerIdent;
				let instructionPointerIndex = body.findIndex((varDecl, index) => {
					if (!utils.specMatch(varDecl,
						utils.parseStatement('var $_IGNORE_ = $_Literal_'))) {
						return;
					}
					instructionPointerIdent = varDecl.declarations[0].id.name;
					let loop = body[index + 1];
					let statements = [loop];
					if (loop.type === 'BlockStatement') {
						statements = loop.body;
					}

					for (let i in statements) {
						let statement = statements[i];
						if (utils.specMatch(statement, {
							type: 'WhileStatement',
							test: utils.parseExpression(`${instructionPointerIdent} < $_Literal_`)
						})) {
							endLabel = statement.test.right.value;
							if (statement.body.type === 'SwitchStatement') {
								cases = statement.body.cases;
							} else if (statement.body.type === 'BlockStatement' &&
								statement.body.body.length === 1 &&
								statement.body.body[0].type === 'SwitchStatement') {
								cases = statement.body.body[0].cases;
							}
							if (typeof cases !== 'undefined') {
								return true;
							}
						}
					}
				});
				if (instructionPointerIndex === -1) {
					return;
				}

				let instructionPointerDecl = body[instructionPointerIndex].declarations[0];
				let caseMap = {};
				let initLabel = instructionPointerDecl.init.value;
				for (let switchCase of cases) {
					if (switchCase.test === null ||
						switchCase.test.type !== 'Literal') {
						return;
					}
					if (switchCase.consequent.length === 0 ||
						!utils.specMatch(switchCase.consequent[0], utils.parseStatement(`${instructionPointerIdent} = $_IGNORE_`)) ||
						['BreakStatement', 'ContinueStatement'].indexOf(switchCase.consequent[switchCase.consequent.length - 1].type)) {
						return;
					}

					let analysedCase = {
						consequent: switchCase.consequent[0].expression.right,
						statements: switchCase.consequent.slice(1,
							(switchCase.consequent[switchCase.consequent.length - 1].label !== null) ? 
							switchCase.consequent.length
							: switchCase.consequent.length - 1),
					}
					if (analysedCase.consequent.type === 'Literal') {
						analysedCase.consequent = analysedCase.consequent.value;
					} else if (analysedCase.consequent.type === 'ConditionalExpression') {
						analysedCase.test = analysedCase.consequent.test;
						analysedCase.alternate = analysedCase.consequent.alternate.value;
						analysedCase.consequent = analysedCase.consequent.consequent.value;
					}
					caseMap[switchCase.test.value] = analysedCase;
					caseMap[switchCase.test.value].predecessor = [];
				}
				analysePredecessors(caseMap);
				let recoveredStatements = recoverStatements(caseMap, initLabel, endLabel);
				if (recoveredStatements === null) {
					return;
				}
				body.splice(instructionPointerIndex, 2, ...recoveredStatements);
				return true;
			}
		});
	}
}

