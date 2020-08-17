import * as utils from './utils.js';

// Original design by Backer Street Software
// http://www.backerstreet.com/decompiler/control_flow_graph.php

function analysePredecessors(nodeMap, current, exitNode, visited = new Set()) {
	visited.add(current);
	nodeMap[current].predecessors = nodeMap[current].predecessors || new Set();
	if (current !== exitNode) {
		let successors = [nodeMap[current].consequent];
		if (nodeMap[current].test) {
			successors.push(nodeMap[current].alternate);
		}
		for (let successor of successors) {
			(nodeMap[successor].predecessors = nodeMap[successor].predecessors || new Set()).add(current);
			if (!visited.has(successor)) {
				analysePredecessors(nodeMap, successor, exitNode, visited);
			}
		}
	}
}

function analyseDominators(nodeMap, entryNode, exitNode) {
	for (let [label, node] of Object.entries(nodeMap)) {
		label -= 0;
		node.dominators = new Set((label === entryNode) ?
			[entryNode] :
			Object.keys(nodeMap).map(n => n - 0));
		node.postDominators = new Set((label === exitNode) ?
			[exitNode] :
			Object.keys(nodeMap).map(n => n - 0));
	}

	let domsDone = false;
	let pdomsDone = false;
	do {
		let domsChanged = false;
		let pdomsChanged = false;
		for (let label in nodeMap) {
			label -= 0;
			if (!domsDone && label !== entryNode) {
				for (let predecessor of nodeMap[label].predecessors) {
					let oldDoms = new Set(nodeMap[label].dominators);
					let newDoms = nodeMap[label].dominators = new Set([...oldDoms].filter(
						d => d === label || nodeMap[predecessor].dominators.has(d)));
					domsChanged = domsChanged || oldDoms.size !== newDoms.size;
				}
			}
			if (!pdomsDone && label !== exitNode) {
				let successors = [nodeMap[label].consequent];
				if (nodeMap[label].alternate) {
					successors.push(nodeMap[label].alternate);
				}
				for (let successor of successors) {
					let oldPdoms = new Set(nodeMap[label].postDominators);
					let newPdoms = nodeMap[label].postDominators = new Set([...oldPdoms].filter(
						d => d === label || nodeMap[successor].postDominators.has(d)));
					pdomsChanged = pdomsChanged || oldPdoms.size !== newPdoms.size;
				}
			}
		}
		if (!domsDone) {
			domsDone = !domsChanged;
		}
		if (!pdomsDone) {
			pdomsDone = !pdomsChanged;
		}
	} while (!domsDone || !pdomsDone);

	for (let [label, node] of Object.entries(nodeMap)) {
		label -= 0;
		let idomsDoms = new Set([...node.dominators].filter(d => d !== label));
		if (label === entryNode) {
			node.immediateDominator = null;
		} else {
			for (let dominator of idomsDoms) {
				let dominators = nodeMap[dominator].dominators;
				if (dominators.size === idomsDoms.size && [...dominators].every(d => idomsDoms.has(d))) {
					node.immediateDominator = dominator;
					break;
				}
			}
		}
		let ipdomsDoms = new Set([...node.postDominators].filter(d => d !== label));
		if (label === exitNode) {
			node.immediatePostDominator = null;
		} else {
			for (let postDominator of ipdomsDoms) {
				let postDominators = nodeMap[postDominator].postDominators;
				if (postDominators.size === ipdomsDoms.size && [...postDominators].every(d => ipdomsDoms.has(d))) {
					node.immediatePostDominator = postDominator;
					break;
				}
			}
		}
	}
}

function constructLoop(nodeMap, leader, trailer) {
	let stack = [];
	let loop = [leader];
	if (leader !== trailer) {
		loop.push(trailer);
		stack.push(trailer);
	}
	while (stack.length > 0) {
		let block = stack.pop();
		for (let predecessor of nodeMap[block].predecessors) {
			if (loop.indexOf(predecessor) === -1) {
				loop.splice(1, 0, predecessor);
				stack.push(predecessor);
			}
		}
	}
	return loop;
}

export function recoverStatements(nodeMap, entryNode, exitNode) {
	analysePredecessors(nodeMap, entryNode, exitNode);
	analyseDominators(nodeMap, entryNode, exitNode);
	let loops = {};

	for (let node in nodeMap) {
		if (node === entryNode) {
			continue;
		}

		let successors = [nodeMap[node].consequent];
		if (nodeMap[node].test) {
			successors.push(nodeMap[node].alternate);
		}
		for (let successor of successors) {
			if (nodeMap[node].dominators.has(successor)) {
				loops[successor] = constructLoop(nodeMap, successor, node - 0);
			}
		}
	}
	let statements = [];
	let current = entryNode;
	while (current !== exitNode) {
		if (current in loops) {
			let loop = loops[current];
			let statement;
			let blocks;
			let leader = nodeMap[loop[0]];
			let trailer = nodeMap[loop[loop.length - 1]];
			let testblock;
			if (leader.test) {
				statement = {
					type: 'WhileStatement',
					test: leader.test,
					body: {
						type: 'BlockStatement',
						body: [],
					},
				};
				testblock = leader;
				statements.push(...leader.statements);
				blocks = loop.slice(1);
			} else if (trailer.test) {
				statement = {
					type: 'DoWhileStatement',
					test: trailer.test,
					body: {
						type: 'BlockStatement',
						body: [],
					},
				};
				testblock = trailer;
				blocks = loop;
			} else {
				throw `Informal loop ${entryNode} -> ${loop} -> ${exitNode} (conditional not at front or back)`;
			}
			if (loop.indexOf(testblock.consequent) === -1) {
				current = testblock.consequent;
			} else if (loop.indexOf(testblock.alternate) === -1) {
				current = testblock.alternate;
			} else {
				throw `Informal loop ${entryNode} -> ${loop} -> ${exitNode} (FIXME: infinite loop)`;
			}
			for (let block of blocks) {
				if (nodeMap[block].test && testblock !== trailer) {
					throw `Informal loop ${entryNode} -> ${loop} -> ${exitNode} (conditional within loop)`;
				}
				statement.body.body.push(...nodeMap[block].statements);
			}
			if (statement.type === 'DoWhileStatement') {
				statement.body.body.push(...trailer.statements);
			} else if (statement.type === 'WhileStatement') {
				statement.body.body.push(...leader.statements);

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
		} else if (nodeMap[current].test) {
			let consequentNodes = [];
			let alternateNodes = [];
			let consequentWalker = nodeMap[current].consequent;
			let alternateWalker = nodeMap[current].alternate;
			do {
				if (consequentWalker !== null) {
					consequentNodes.push(consequentWalker);
					if (consequentWalker === exitNode || nodeMap[consequentWalker].test) {
						consequentWalker = null;
					} else {
						consequentWalker = nodeMap[consequentWalker].consequent;
					}
				}
				if (alternateWalker !== null) {
					alternateNodes.push(alternateWalker);
					if (alternateWalker === exitNode || nodeMap[alternateWalker].test) {
						alternateWalker = null;
					} else {
						alternateWalker = nodeMap[alternateWalker].consequent;
					}
				}
			} while (consequentWalker !== null || alternateWalker !== null);
			if (consequentNodes[consequentNodes.length - 1] !== alternateNodes[alternateNodes.length - 1]) {
				throw `Nested if in ${current}`;
			}

			let prologueStart;
			while (consequentNodes[consequentNodes.length - 1] === alternateNodes[alternateNodes.length - 1]) {
				prologueStart = consequentNodes.pop(), alternateNodes.pop();
			}

			let test = nodeMap[current].test;
			if (consequentNodes.length === 0) {
				test = (utils.specMatch(test, utils.parseExpression('!$_IGNORE_'))) ? test.argument : {
					type: 'UnaryExpression',
					operator: '!',
					prefix: true,
					argument: test,
				};
				consequentNodes = alternateNodes;
				alternateNodes = [];
			}

			let consequentBody = consequentNodes.flatMap(node => nodeMap[node].statements);
			if (consequentBody.length === 1 && consequentBody[0].type === 'BlockStatement') {
				consequentBody = consequentBody[0].body;
			}

			let alternateBody = null;
			if (alternateNodes.length > 0) {
				alternateBody = alternateNodes.flatMap(node => nodeMap[node].statements);
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
				alternate: (alternateNodes.length === 0) ? null : {
					type: 'BlockStatement',
					body: alternateBody,
				},
			});
			current = prologueStart;
		} else {
			statements.push(...nodeMap[current].statements);
			current = nodeMap[current].consequent;
		}
	}

	return statements;
}
