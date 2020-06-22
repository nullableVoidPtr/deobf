const utils = require('../../utils.js');
const estraverse = require('estraverse');

function analysePredecessors(caseMap, current, endLabel, visited = new Set()) {
	if (current !== endLabel) {
		visited.add(current);
		let successors = [caseMap[current].consequent];
		if ('test' in caseMap[current]) {
			successors.push(caseMap[current].alternate);
		}
		caseMap[current].predecessors = caseMap[current].predecessors || new Set();
		for (let successor of successors) {
			if (successor !== endLabel) {
				(caseMap[successor].predecessors = caseMap[successor].predecessors || new Set()).add(current);
				if (!visited.has(successor)) {
					analysePredecessors(caseMap, successor, endLabel, visited)
				}
			}
		}
	}
}

function analyseCases(cases, labelIdent, initLabel, endLabel) {
	let caseMap = {}
	for (let switchCase of cases) {
		if (switchCase.test === null ||
			switchCase.test.type !== 'Literal') {
			return null;
		}
		if (switchCase.consequent.length === 0 ||
			!['BreakStatement', 'ContinueStatement', 'ReturnStatement'].includes(switchCase.consequent[switchCase.consequent.length - 1].type)) {
			return null;
		}

		if (!utils.specMatch(switchCase.consequent[0], utils.parseStatement(`${labelIdent} = $_IGNORE_`))) {
			return null;
		}

		let analysedCase = {
			consequent: switchCase.consequent[0].expression.right,
			statements: switchCase.consequent.slice(1),
		}

		let footer = analysedCase.statements.pop();
		if (footer.type === 'ContinueStatement' && footer.label === null) {
			return null;
		} else if (footer.type !== 'BreakStatement' || footer.label !== null) {
			analysedCase.statements.push(footer);
		}

		if (analysedCase.consequent.type === 'Literal') {
			analysedCase.consequent = analysedCase.consequent.value;
		} else if (analysedCase.consequent.type === 'ConditionalExpression') {
			analysedCase.test = analysedCase.consequent.test;
			analysedCase.alternate = analysedCase.consequent.alternate.value;
			analysedCase.consequent = analysedCase.consequent.consequent.value;
		} else {
			return null;
		}
		caseMap[switchCase.test.value] = analysedCase;
	}
	analysePredecessors(caseMap, initLabel, endLabel);
	return caseMap;
}

function getDominatorMap(caseMap, initialLabel, endLabel) {
	for (let label in caseMap) {
		caseMap[label].dominators = new Set((label - 0 === initialLabel) ?
			[initialLabel] :
			Object.keys(caseMap).map(n => n - 0));
	}

	let changed;
	do {
		changed = false;
		for (let label in caseMap) {
			label -= 0;
			if (label === initialLabel) {
				continue;
			}

			for (let predecessor of caseMap[label].predecessors) {
				let oldDominators = new Set(caseMap[label].dominators);
				let newDominators = caseMap[label].dominators = new Set([...oldDominators].filter(
					d => d === label || caseMap[predecessor].dominators.has(d)));
				changed = changed || oldDominators.size !== newDominators.size ||
					[...oldDominators].some(d => !newDominators.has(d));
			}
		}
	} while (changed);
}

function constructLoop(caseMap, header, tail) {
	let stack = [];
	let loop = [header];
	if (header !== tail) {
		loop.push(tail);
		stack.push(tail);
	}
	while (stack.length > 0) {
		block = stack.pop();
		for (let predecessor of caseMap[block].predecessors) {
			if (loop.indexOf(predecessor) === -1) {
				loop.splice(1, 0, predecessor);
				stack.push(predecessor);
			}
		}
	}
	return loop;
}

function recoverStatements(caseMap, initLabel, endLabel) {
	getDominatorMap(caseMap, initLabel, endLabel);
	let loops = {};

	for (let label in caseMap) {
		if (label === initLabel) {
			continue;
		}

		let successors = [caseMap[label].consequent];
		if ('test' in caseMap[label]) {
			successors.push(caseMap[label].alternate);
		}
		for (let successor of successors) {
			if (caseMap[label].dominators.has(successor)) {
				loops[successor] = constructLoop(caseMap, successor, label - 0);
			}
		}
	}
	let statements = [];
	let current = initLabel;
	while (current !== endLabel) {
		if (current in loops) {
			let loop = loops[current];
			let statement;
			let blocks;
			let prologue;
			let header = caseMap[loop[0]];
			let footer = caseMap[loop[loop.length - 1]];
			let testblock;
			if ('test' in header) {
				statement = {
					type: 'WhileStatement',
					test: header.test,
					body: {
						type: 'BlockStatement',
						body: [],
					},
				};
				testblock = header;
				statements.push(...header.statements)
				blocks = loop.slice(1);
			} else if ('test' in footer) {
				statement = {
					type: 'DoWhileStatement',
					test: footer.test,
					body: {
						type: 'BlockStatement',
						body: [],
					},
				};
				testblock = footer;
				blocks = loop;
			} else {
				throw `Informal loop ${loop}`;
			}
			if ('consequent' in testblock && loop.indexOf(testblock.consequent) === -1) {
				current = testblock.consequent;
			} else if ('alternate' in testblock && loop.indexOf(testblock.alternate) === -1) {
				current = testblock.alternate;
			} else {
				throw `Informal loop ${loop}`;
			}
			for (let block of blocks) {
				if ('test' in caseMap[block] && testblock !== footer) {
					throw `Informal loop ${loop}`;
				}
				statement.body.body.push(...caseMap[block].statements);
			}
			if (statement.type === 'DoWhileStatement') {
				statement.body.body.push(...footer.statements);
			} else if (statement.type === 'WhileStatement') {
				statement.body.body.push(...header.statements);

				let update = statement.body.body.pop();
				if (update.type === 'ExpressionStatement') {
					update = update.expression;
				} else {
					statement.body.body.push(update);
					update = null;
				}

				let init = null;
				if (statements.length > 0) {
					init = statements.pop();
					if (init.type === 'ExpressionStatement') {
						init = init.expression;
					} else if (init.type !== 'VariableDeclaration'){
						statements.push(init);
						init = null;
					}
				}

				if (update !== null || init !== null) {
					statement.type = 'ForStatement';
					statement.init = init;
					statement.update = update;
				}
			}

			if (statement.body.body.length === 1 && statement.body.body[0].type === "BlockStatement") {
				statement.body = statement.body.body[0];
			}
			statements.push(statement);
		} else if ('test' in caseMap[current]) {
			let consequentLabels = [];
			let alternateLabels = [];
			let consequentWalker = caseMap[current].consequent;
			let alternateWalker = caseMap[current].alternate;
			do {
				if (consequentWalker !== null) {
					consequentLabels.push(consequentWalker);
					if (consequentWalker === endLabel || 'test' in caseMap[consequentWalker]) {
						consequentWalker = null;
					} else {
						consequentWalker = caseMap[consequentWalker].consequent;
					}
				}
				if (alternateWalker !== null) {
					alternateLabels.push(alternateWalker);
					if (alternateWalker === endLabel || 'test' in caseMap[alternateWalker]) {
						alternateWalker = null;
					} else {
						alternateWalker = caseMap[alternateWalker].consequent;
					}
				}
			} while (consequentWalker !== null || alternateWalker !== null);
			if (consequentLabels[consequentLabels.length - 1] !== alternateLabels[alternateLabels.length - 1]) {
				throw `Nested if in ${current}`;
			}

			let prologueStart;
			while (consequentLabels[consequentLabels.length - 1] === alternateLabels[alternateLabels.length - 1]) {
				prologueStart = consequentLabels.pop(), alternateLabels.pop();
			}

			let test = caseMap[current].test;
			if (consequentLabels.length === 0) {
				test = (utils.specMatch(ifStatement.test, utils.parseExpression('!$_IGNORE_'))) ? test.argument : {
					type: 'UnaryExpression',
					operator: '!',
					prefix: true,
					argument: ifStatement.test,
				};
				consequentLabels = alternateLabels;
				alternateLabels = [];
			}

			let consequentBody = consequentLabels.flatMap(label => caseMap[label].statements);
			if (consequentBody.length === 1 && consequentBody[0].type === "BlockStatement") {
				consequentBody = consequentBody[0].body;
			}

			let alternateBody = null;
			if (alternateLabels.length > 0) {
				alternateBody = alternateLabels.flatMap(label => caseMap[label].statements);
				if (alternateBody.length === 1 && alternateBody[0].type === "BlockStatement") {
					alternateBody = alternateBody[0].body;
				}
			}

			statements.push({
				type: 'IfStatement',
				test: test,
				consequent: {
					type: 'BlockStatement',
					body: consequentBody,
				},
				alternate: (alternateLabels.length === 0) ? null : {
					type: 'BlockStatement',
					body: alternateBody,
				},
			});
			current = prologueStart;
		} else {
			statements.push(...caseMap[current].statements);
			current = caseMap[current].consequent;
		}
	}

	return statements;
}

module.exports = class ControlFlowRecoveryPass extends require('../BasePass.js') {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree, options) {
		let changed = false;
		estraverse.traverse(tree, {
			leave: (scope) => utils.modifyScope(scope,
				(varDecl, index, body) => {
					if (index === -1) {
						return;
					}

					let instructionPointerIdent = varDecl.declarations[0].id.name;

					let parentLabel;
					let loop = body[index + 1];
					let statements = [loop];
					if (loop.type === 'BlockStatement') {
						statements = loop.body;
					} else if (loop.type === 'LabeledStatement') {
						parentLabel = loop.label;
						statements = [loop.body];
					}

					let cases;
					let endLabel;
					for (let statement of statements) {
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
								break;
							}
						}
					}
					if (typeof cases === 'undefined') {
						return;
					}

					let initLabel = body[index].declarations[0].init.value;
					let caseMap = analyseCases(cases, instructionPointerIdent, initLabel, endLabel)
					if (caseMap === null) {
						return;
					}

					let recoveredStatements = recoverStatements(caseMap, initLabel, endLabel);
					if (typeof parentLabel !== 'undefined') {
						recoveredStatements[0] = {
							type: 'LabeledStatement',
							label: parentLabel,
							body: recoveredStatements[0],
						};
					}
					body.splice(index, 2, ...recoveredStatements);
					changed = true;
				},
				varDecl =>
				utils.specMatch(varDecl, utils.parseStatement('var $_IGNORE_ = $_Literal_')),
				varDecl => varDecl.declarations[0].id.name),
		});
		return changed;
	}
}

