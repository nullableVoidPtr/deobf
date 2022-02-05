import * as utils from './utils.js';

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

function reduceSimple(nodeMap, entryLabel, exitLabel) {
	let changed = false;
	do {
		// sequence
		// if
		// if then
		// single block while
		console.log("https://dreampuf.github.io/GraphvizOnline/#digraph%20G%20%7Ba1%20-%3E%20b3%3B%20b2%20-%3E%20a3%3B%20a3%20-%3E%20a0%3B%20a3%20-%3E%20end%3B%20b3%20-%3E%20end%3B%7D")
	} while (changed);
}

export function recoverStatements(nodeMap, entryNode, exitNode) {
	analysePredecessors(nodeMap, entryNode, exitNode);
	analyseDominators(nodeMap, entryNode, exitNode);
	reduceSimple(nodeMap, entryNode, exitNode);
}
