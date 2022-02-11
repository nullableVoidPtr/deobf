import * as utils from './utils.js';

function analysePredecessors(controlFlow, current = controlFlow.entry, visited = new Set()) {
	let nodeMap = controlFlow.nodes;
	visited.add(current);
	nodeMap[current].predecessors = nodeMap[current].predecessors || new Set();
	if (current !== controlFlow.exit) {
		let successors = [nodeMap[current].consequent];
		if (nodeMap[current].test) {
			successors.push(nodeMap[current].alternate);
		}
		for (let successor of successors) {
			(nodeMap[successor].predecessors = nodeMap[successor].predecessors || new Set()).add(current);
			if (!visited.has(successor)) {
				analysePredecessors(controlFlow, successor, visited);
			}
		}
	}
}

function analyseDominators(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let {entry, exit} = controlFlow;
	for (let [label, node] of Object.entries(nodeMap)) {
		label -= 0;
		node.dominators = new Set((label === entry) ?
			[entry] :
			Object.keys(nodeMap).map(n => n - 0));
		node.postDominators = new Set((label === exit) ?
			[exit] :
			Object.keys(nodeMap).map(n => n - 0));
	}

	let domsDone = false;
	let pdomsDone = false;
	do {
		let domsChanged = false;
		let pdomsChanged = false;
		for (let label in nodeMap) {
			label -= 0;
			if (!domsDone && label !== entry) {
				for (let predecessor of nodeMap[label].predecessors) {
					let oldDoms = new Set(nodeMap[label].dominators);
					let newDoms = nodeMap[label].dominators = new Set([...oldDoms].filter(
						d => d === label || nodeMap[predecessor].dominators.has(d)));
					domsChanged = domsChanged || oldDoms.size !== newDoms.size;
				}
			}
			if (!pdomsDone && label !== exit) {
				let successors = [nodeMap[label].consequent];
				if (nodeMap[label].test) {
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
		if (label === entry) {
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
		if (label === exit) {
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

function reduceSequence(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let reduced = false;

	for (let [parentLabel, parentNode] of Object.entries(nodeMap)) {
		if (parentNode?.__deleted) {
			continue;
		}
		parentLabel -= 0;
		if (parentNode.consequent === null ||
			parentNode.alternate !== null ||
			parentNode.test !== null) {
			continue;
		}

		let childLabel = parentNode.consequent;
		let childNode = nodeMap[childLabel];

		if (childLabel === controlFlow.entry ||
			childNode.predecessors.size !== 1) {
			continue;
		}

		if (childNode.consequent === null && controlFlow.exit == childLabel){
			parentNode.consequent = null;
			parentNode.statementsAfter = parentNode.statementsAfter.concat(
				childNode.statementsBefore ?? [],
				childNode.statementsAfter ?? [],
			);
			childNode.__deleted = true;
			controlFlow.exit = parentLabel;
			reduced = true;
			continue;
		}

		if (childNode.alternate !== null ||
			childNode.test !== null ||
			childNode.consequent === parentLabel) {
			continue;
		}

		parentNode.statementsBefore = parentNode.statementsBefore.concat(
			parentNode.statementsAfter,
			childNode.statementsBefore,
		)

		parentNode.statementsAfter = childNode.statementsAfter ?? [];
		parentNode.consequent = childNode.consequent;
		let newSuccessor = nodeMap[parentNode.consequent];
		newSuccessor.predecessors.delete(childLabel);
		newSuccessor.predecessors.add(parentLabel);
		nodeMap[childLabel].__deleted = true;
		reduced = true;
	}

	for (let label in nodeMap) {
		if (nodeMap[label]?.__deleted) {
			delete nodeMap[label];
		}
	}

	return reduced;
}

function reduceSimpleIf(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let reduced = false;


	for (let [parentLabel, parentNode] of Object.entries(nodeMap)) {
		if (parentNode?.__deleted) {
			continue;
		}
		parentLabel -= 0;
		if (parentNode.consequent === null ||
			parentNode.alternate === null ||
			parentNode.test === null) {
			continue;
		}

		let truthyPath = parentNode.consequent;
		let falsyPath = parentNode.alternate;
		
		if (truthyPath === controlFlow.entry &&
			falsyPath === controlFlow.entry) {
			continue;
		}

		if (nodeMap[truthyPath].consequent === null &&
			nodeMap[falsyPath].consequent === null) {
			continue;
		}

		let truthySuccessor = nodeMap[truthyPath].consequent;
		let falsySuccessor = nodeMap[falsyPath].consequent;
		if (truthySuccessor === falsyPath &&
			nodeMap[truthyPath].predecessors.size === 1 &&
			nodeMap[truthyPath].test === null &&
			nodeMap[truthyPath].alternate === null) {
			parentNode.statementsBefore.push({
				type: 'IfStatement',
				test: parentNode.test,
				consequent: {
					type: 'BlockStatement',
					body: parentNode.statementsAfter.concat(
						nodeMap[truthyPath].statementsBefore,
						nodeMap[truthyPath].statementsAfter,
					)
				},
				alternate: parentNode.statementsAfter.length === 0 ? null : {
					type: 'BlockStatement',
					body: parentNode.statementsAfter,
				}
			});

			parentNode.statementsAfter = [];
			parentNode.alternate = parentNode.test = null;
			parentNode.consequent = falsyPath;
			nodeMap[truthyPath].__deleted = true;
			nodeMap[truthySuccessor].predecessors.delete(truthyPath);
			reduced = true;
		} else if (falsySuccessor === truthyPath &&
			nodeMap[falsyPath].predecessors.size === 1 &&
			nodeMap[falsyPath].test === null &&
			nodeMap[falsyPath].alternate === null) {
			parentNode.statementsBefore.push({
				type: 'IfStatement',
				test: {
					type: 'UnaryExpression',
					operator: '!',
					prefix: true,
					argument: parentNode.test,
				},
				consequent: {
					type: 'BlockStatement',
					body: parentNode.statementsAfter.concat(
						nodeMap[truthyPath].statementsBefore,
						nodeMap[truthyPath].statementsAfter,
					)
				},
				alternate: parentNode.statementsAfter.length === 0 ? null : {
					type: 'BlockStatement',
					body: parentNode.statementsAfter,
				}
			});

			parentNode.statementsAfter = [];
			parentNode.alternate = parentNode.test = null;
			nodeMap[falsyPath].__deleted = true;
			nodeMap[falsyPath].predecessors.delete(falsyPath);
			reduced = true;
		} else if (truthySuccessor === falsySuccessor &&
			nodeMap[truthyPath].predecessors.size === 1 &&
			nodeMap[falsyPath].predecessors.size === 1 &&
			nodeMap[truthyPath].test === null &&
			nodeMap[falsyPath].test === null &&
			nodeMap[truthyPath].alternate === null &&
			nodeMap[falsyPath].alternate === null) {
			let constructedIf = {
				type: 'IfStatement',
				test: parentNode.test,
				consequent: {
					type: 'BlockStatement',
					body: parentNode.statementsAfter.concat(
						nodeMap[truthyPath].statementsBefore,
						nodeMap[truthyPath].statementsAfter,
					)
				},
				alternate: {
					type: 'BlockStatement',
					body: parentNode.statementsAfter.concat(
						nodeMap[falsyPath].statementsBefore,
						nodeMap[falsyPath].statementsAfter,
					)
				},
			};
			if (constructedIf.alternate.body.length === 1 &&
				constructedIf.alternate.body[0].type == 'IfStatement') {
				constructedIf.alternate = constructedIf.alternate.body[0];
			}
			parentNode.statementsBefore.push(constructedIf);

			parentNode.statementsAfter = [];
			parentNode.alternate = parentNode.test = null;
			parentNode.consequent = truthySuccessor;
			nodeMap[truthyPath].__deleted = true;
			nodeMap[falsyPath].__deleted = true;
			nodeMap[truthySuccessor].predecessors.delete(truthyPath);
			nodeMap[truthySuccessor].predecessors.delete(falsyPath);
			nodeMap[truthySuccessor].predecessors.add(parentLabel);
			reduced = true;
		}
	}

	for (let label in nodeMap) {
		if (nodeMap[label]?.__deleted) {
			delete nodeMap[label];
		}
	}

	return reduced;
}

function reduceSimpleDoWhile(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let reduced = false;

	for (let [footerLabel, footerNode] of Object.entries(nodeMap)) {
		if (footerNode?.__deleted) {
			continue;
		}
		footerLabel -= 0;
		if (footerNode.consequent === null ||
			footerNode.alternate === null ||
			footerNode.test === null ||
			footerNode.predecessors.size !== 1) {
			continue;
		}
		
		let consequentNode = nodeMap[footerNode.consequent];
		let alternateNode = nodeMap[footerNode.alternate];

		let loopBody;
		let successor;
		let doWhileTest;

		if (consequentNode.alternate === null &&
			consequentNode.test === null &&
			consequentNode.consequent === footerLabel) {
			loopBody = footerNode.consequent;
			successor = footerNode.alternate;
			doWhileTest = footerNode.test;
		} else if (alternateNode.alternate === null &&
			alternateNode.test === null &&
			alternateNode.consequent === footerLabel) {
			loopBody = footerNode.alternate;
			successor = footerNode.consequent;
			doWhileTest = {
				type: 'UnaryExpression',
				operator: '!',
				prefix: true,
				argument: footerNode.test,
			}
		} else {
			continue;
		}

		if (footerNode.statementsAfter.length !== 0) {
			console.warn("Odd footerNode, has non-empty statementsAfter, semantics will be lost")
		}
		
		let loopBodyNode = nodeMap[loopBody];
		let successorNode = nodeMap[successor];


		loopBodyNode.statementsBefore = [{
			type: 'DoWhileStatement',
			test: doWhileTest,
			body: {
				type: 'BlockStatement',
				body: loopBodyNode.statementsBefore.concat(
					loopBodyNode.statementsAfter,
					footerNode.statementsBefore
				),
			},
		}];
			
		loopBodyNode.predecessors.delete(footerLabel);
		successorNode.statementsBefore = footerNode.statementsAfter.concat(successorNode.statementsBefore ?? []);

		loopBodyNode.consequent = successor;
		loopBodyNode.alternate = loopBodyNode.test = null;

		footerNode.__deleted = true;
		reduced = true;
	}

	for (let label in nodeMap) {
		if (nodeMap[label]?.__deleted) {
			delete nodeMap[label];
		}
	}

	return reduced;
}

function reduceSimpleWhile(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let reduced = false;

	for (let [headerLabel, headerNode] of Object.entries(nodeMap)) {
		if (headerNode?.__deleted) {
			continue;
		}
		headerLabel -= 0;
		if (headerNode.consequent === null ||
			headerNode.alternate === null ||
			headerNode.test === null) {
			continue;
		}

		if (headerNode.consequent === headerNode.alternate) { //??
			continue;
		}

		let consequentNode = nodeMap[headerNode.consequent];
		let alternateNode = nodeMap[headerNode.alternate];
	
		// single block while
		if (headerNode.consequent === headerLabel) {
			headerNode.predecessors.delete(headerLabel);
			headerNode.statementsBefore.push({
				type: 'WhileStatement',
				test: headerNode.test,
				body: {
					type: 'BlockStatement',
					body: headerNode.statementsAfter.concat(headerNode.statementsBefore),
				},
			});
			headerNode.consequent = headerNode.alternate;
			headerNode.alternate = headerNode.test = null;
			alternateNode.statementsBefore = headerNode.statementsAfter.concat(alternateNode.statementsBefore ?? []);

			headerNode.statementsAfter = [];
			reduced = true;
			continue;
		} else if (headerNode.alternate === headerLabel) {
			headerNode.predecessors.delete(headerLabel);
			headerNode.statementsBefore.push({
				type: 'WhileStatement',
				test: {
					type: 'UnaryExpression',
					operator: '!',
					prefix: true,
					argument: headerNode.test,
				},
				body: {
					type: 'BlockStatement',
					body: headerNode.statementsAfter.concat(headerNode.statementsBefore),
				},
			});
			headerNode.alternate = headerNode.test = null;
			consequentNode.statementsBefore = headerNode.statementsAfter.concat(consequentNode.statementsBefore);
			
			headerNode.statementsAfter = [];
			reduced = true;
			continue;
		}

		// two block while
		let loopBody;
		let successor;
		let whileTest = headerNode.test;
		if (headerNode.consequent !== controlFlow.entry &&
			consequentNode.consequent === headerLabel &&
			consequentNode.test === null &&
			consequentNode.alternate === null &&
			consequentNode.predecessors.size === 1) {
			loopBody = headerNode.consequent;
			successor = headerNode.alternate;
		} else if (headerNode.alternate !== controlFlow.entry &&
			alternateNode.consequent === headerLabel &&
			alternateNode.test === null &&
			alternateNode.alternate === null &&
			alternateNode.predecessors.size === 1) {
			loopBody = headerNode.alternate;
			successor = headerNode.consequent;
			test = {
				type: 'UnaryExpression',
				operator: '!',
				prefix: true,
				argument: headerNode.test,
			}
		} else {
			continue;
		}

		let loopBodyNode = nodeMap[loopBody];
		let successorNode = nodeMap[successor];

		headerNode.statementsBefore.push({
			type: 'WhileStatement',
			test: whileTest,
			body: {
				type: 'BlockStatement',
				body: headerNode.statementsAfter.concat(
					loopBodyNode.statementsBefore,
					loopBodyNode.statementsAfter,
					headerNode.statementsBefore
				),
			},
		});
		headerNode.predecessors.delete(loopBody);
		successorNode.statementsBefore = headerNode.statementsAfter.concat(successorNode.statementsBefore);
		headerNode.statementsAfter = [];

		headerNode.consequent = successor;
		headerNode.alternate = headerNode.test = null;

		loopBodyNode.__deleted = true;
		reduced = true;
	}

	for (let label in nodeMap) {
		if (nodeMap[label]?.__deleted) {
			delete nodeMap[label];
		}
	}

	return reduced;
}

function visualise(controlFlow) {
	let nodeMap = controlFlow.nodes;
	let graphviz = "digraph G {";
	for (let [label, node] of Object.entries(nodeMap)) {
		label -= 0;
		graphviz += `${label};`;
		if (node.consequent === null) continue;
		graphviz += `${label}->${node.consequent};`;
		if (node.alternate !== null) {
			graphviz += `${label}->${node.alternate};`;
		}
	}
	graphviz += "}";
	console.log("https://dreampuf.github.io/GraphvizOnline/#" + encodeURIComponent(graphviz));
}

function reduceSimple(controlFlow) {
	visualise(controlFlow);
	let changed;
	do {
		changed = false;
		changed = reduceSequence(controlFlow) || changed;
		changed = reduceSimpleIf(controlFlow) || changed;
		changed = reduceSimpleDoWhile(controlFlow) || changed;
		changed = reduceSimpleWhile(controlFlow) || changed;
		visualise(controlFlow);
	} while (changed);
}

export function recoverStatements(controlFlow) {
	analysePredecessors(controlFlow);
	reduceSimple(controlFlow);
	analyseDominators(controlFlow);
	//TODO sophisticated analysis
	if (Object.keys(controlFlow.nodes).length === 1) {
		let node = Object.values(controlFlow.nodes)[0];
		if (node.test !== null) throw Error('wtf?');

		return node.statementsBefore.concat(node.statementsAfter).filter(x => typeof x != 'undefined');
	} else {
		//TODO reconstruct switch case
	}
}
