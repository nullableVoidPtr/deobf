import * as utils from './utils.js';

// Original design by Backer Street Software
// http://www.backerstreet.com/decompiler/control_flow_graph.php

function analysePredecessors(caseMap, current, endLabel, visited = new Set()) {
	if (current !== endLabel) {
		visited.add(current);
		let successors = [caseMap[current].consequent];
		if (caseMap[current].test) {
			successors.push(caseMap[current].alternate);
		}
		caseMap[current].predecessors = caseMap[current].predecessors || new Set();
		for (let successor of successors) {
			if (successor !== endLabel) {
				(caseMap[successor].predecessors = caseMap[successor].predecessors || new Set()).add(current);
				if (!visited.has(successor)) {
					analysePredecessors(caseMap, successor, endLabel, visited);
				}
			}
		}
	}
}

function analyseDominators(caseMap, initialLabel) {
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
		let block = stack.pop();
		for (let predecessor of caseMap[block].predecessors) {
			if (loop.indexOf(predecessor) === -1) {
				loop.splice(1, 0, predecessor);
				stack.push(predecessor);
			}
		}
	}
	return loop;
}

export function recoverStatements(caseMap, initLabel, endLabel) {
	analysePredecessors(caseMap, initLabel, endLabel);
	analyseDominators(caseMap, initLabel);
	let loops = {};

	for (let label in caseMap) {
		if (label === initLabel) {
			continue;
		}

		let successors = [caseMap[label].consequent];
		if (caseMap[label].test) {
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
			let header = caseMap[loop[0]];
			let footer = caseMap[loop[loop.length - 1]];
			let testblock;
			if (header.test) {
				statement = {
					type: 'WhileStatement',
					test: header.test,
					body: {
						type: 'BlockStatement',
						body: [],
					},
				};
				testblock = header;
				statements.push(...header.statements);
				blocks = loop.slice(1);
			} else if (footer.test) {
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
				throw `Informal loop ${initLabel} -> ${loop} -> ${endLabel} (conditional not at front or back)`;
			}
			if (loop.indexOf(testblock.consequent) === -1) {
				current = testblock.consequent;
			} else if (loop.indexOf(testblock.alternate) === -1) {
				current = testblock.alternate;
			} else {
				throw `Informal loop ${initLabel} -> ${loop} -> ${endLabel} (FIXME: infinite loop)`;
			}
			for (let block of blocks) {
				if (caseMap[block].test && testblock !== footer) {
					throw `Informal loop ${initLabel} -> ${loop} -> ${endLabel} (conditional within loop)`;
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

				if (update || init) {
					statement.type = 'ForStatement';
					statement.init = init;
					statement.update = update;
				}
			}

			if (statement.body.body.length === 1 && statement.body.body[0].type === 'BlockStatement') {
				statement.body = statement.body.body[0];
			}
			statements.push(statement);
		} else if (caseMap[current].test) {
			let consequentLabels = [];
			let alternateLabels = [];
			let consequentWalker = caseMap[current].consequent;
			let alternateWalker = caseMap[current].alternate;
			do {
				if (consequentWalker !== null) {
					consequentLabels.push(consequentWalker);
					if (consequentWalker === endLabel || caseMap[consequentWalker].test) {
						consequentWalker = null;
					} else {
						consequentWalker = caseMap[consequentWalker].consequent;
					}
				}
				if (alternateWalker !== null) {
					alternateLabels.push(alternateWalker);
					if (alternateWalker === endLabel || caseMap[alternateWalker].test) {
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
				test = (utils.specMatch(test, utils.parseExpression('!$_IGNORE_'))) ? test.argument : {
					type: 'UnaryExpression',
					operator: '!',
					prefix: true,
					argument: test,
				};
				consequentLabels = alternateLabels;
				alternateLabels = [];
			}

			let consequentBody = consequentLabels.flatMap(label => caseMap[label].statements);
			if (consequentBody.length === 1 && consequentBody[0].type === 'BlockStatement') {
				consequentBody = consequentBody[0].body;
			}

			let alternateBody = null;
			if (alternateLabels.length > 0) {
				alternateBody = alternateLabels.flatMap(label => caseMap[label].statements);
				if (alternateBody.length === 1 && alternateBody[0].type === 'BlockStatement') {
					alternateBody = alternateBody[0].body;
				}
			}

			statements.push({
				type: 'IfStatement',
				test,
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
