import { MultiDirectedGraph } from 'graphology';
import * as t from '@babel/types';

export type NormalizedBlock = {
	beforeStatements: t.Statement[];
	test: t.Expression | null;
}

export type Block = NormalizedBlock & {
	afterStatements?: t.Statement[];
};

export type Edge = {
	flowPredicate: boolean;
};

export type CFGAttributes = {
	entry: t.Node;
};

export default class ControlFlowGraph extends MultiDirectedGraph<NormalizedBlock, Edge, CFGAttributes> {
	constructor(graph: MultiDirectedGraph<Block, Edge, CFGAttributes>) {
		super();
		const original = graph.copy();
		pushAfterStatements(original);
		this.import(original.export());
	}
}

function sortBranch(graph: ControlFlowGraph, parent: string, successors: string[]): [string, string] {
	const [left, right] = successors;
	const leftEdges = graph.directedEdges(parent, left);
	const rightEdges = graph.directedEdges(parent, right);

	if (leftEdges.length !== 1) throw new TypeError();
	if (rightEdges.length !== 1) throw new TypeError();

	const leftFlow = graph.getEdgeAttribute(leftEdges[0], 'flowPredicate');
	const rightFlow = graph.getEdgeAttribute(rightEdges[0], 'flowPredicate');
	if (leftFlow && !rightFlow) {
		return [right, left];
	} else if (rightFlow && !leftFlow) {
		return [left, right];
	} else {
		throw new TypeError();
	}
}

export function pushAfterStatements(graph: MultiDirectedGraph<Block, Edge, CFGAttributes>) {
	graph.forEachNode((node, block) => {
		if (!block.afterStatements) return;
		const { afterStatements } = block;
		if (afterStatements.length === 0) return;

		const edges = graph.outEdgeEntries(node);
		for (const edge of edges) {
			const newNode = `${edge}:between`;
			graph.addNode(newNode, {
				beforeStatements: afterStatements.slice(),
				test: null,
			});

			const { target } = edge;
			graph.addEdge(node, newNode, graph.getEdgeAttributes(edge))
			graph.addEdge(newNode, target, { flowPredicate: true })
			graph.dropEdge(edge.edge);
		}

		graph.removeNodeAttribute(node, 'afterStatements');
	});
}

function reduceSequence(graph: ControlFlowGraph) {
	const parents = new Map(graph.reduceNodes((acc, parent, {test}) => {
		if (test) {
			return acc;
		}

		const successors = graph.outNeighbors(parent);
		if (successors.length !== 1) {
			return acc;
		}

		const [child] = successors;
		if (parent === child) {
			return acc;
		}
		if (graph.inNeighbors(child).length !== 1) {
			return acc;
		}

		acc.push([parent, child])
		return acc;
	}, [] as [string, string][]));

	if (parents.size === 0) {
		return false;
	}

	for (const [parent, child] of parents) {
		let actualParent = parent;
		while (!graph.hasNode(actualParent)) {
			const grandparentEntry = [...parents.entries()].find(([_, descendant]) => descendant === actualParent);
			if (!grandparentEntry) {
				throw new TypeError();
			}

			[actualParent] = grandparentEntry;
		}

		const attributes = graph.getNodeAttributes(child);
		attributes.beforeStatements.unshift(...graph.getNodeAttribute(actualParent, 'beforeStatements'));

		graph.replaceNodeAttributes(actualParent, attributes)

		for (const newEdge of graph.outEdgeEntries(child)) {
			graph.addEdge(actualParent, newEdge.target, newEdge.attributes);
		}

		graph.dropNode(child);
	}

	return true;
}

function reduceSimpleWhile(graph: ControlFlowGraph) {
	const loops = graph.reduceNodes((acc, header, {test}) => {
		if (!test) {
			return acc;
		}

		const predecessors = graph.inNeighbors(header);
		if (predecessors.length !== 2) {
			return acc;
		}

		const successors = graph.outNeighbors(header);
		if (successors.length !== 2) {
			throw new Error();
		}

		const [falsyBranch, _] = sortBranch(graph, header, successors);

		const body = successors.find(successor => predecessors.includes(successor));
		if (!body) {
			return acc;
		}

		let successor;
		if (body === successors[0]) {
			successor = successors[1];
		} else {
			successor = successors[0];
		}

		let whileTest = test;
		if (body === falsyBranch) {
			whileTest = t.unaryExpression('!', whileTest);
		}

		acc.push({
			header,
			test: whileTest,
			body,
			successor,
		})
		return acc;
	}, [] as {
		header: string,
		test: t.Expression,
		body: string,
		successor: string,
	}[]);

	if (loops.length === 0) {
		return false;
	}

	for (const { header, test, body, successor } of loops) {
		const headerAttributes = graph.getNodeAttributes(header);

		headerAttributes.test = null;
		headerAttributes.beforeStatements.push(
			t.whileStatement(
				test,
				t.blockStatement([
					...graph.getNodeAttribute(body, 'beforeStatements'),
					...headerAttributes.beforeStatements,
				])
			)
		);

		graph.dropNode(body);
		graph.setDirectedEdgeAttribute(header, successor, 'flowPredicate', true);
	}

	return true;
}

function reduceSimpleDoWhile(graph: ControlFlowGraph) {
	const loops = graph.filterNodes((header, {test}) => {
		if (!test) {
			return false;
		}

		const successors = graph.outNeighbors(header);
		if (successors.length !== 2) {
			throw new Error();
		}

		if (!successors.includes(header)) {
			return false;
		}

		return true;
	});

	if (loops.length === 0) {
		return false;
	}

	for (const header of loops) {
		const successors = graph.outNeighbors(header);
		const [falsyBranch, _] = sortBranch(graph, header, successors);

		const attributes = graph.getNodeAttributes(header);
		let { test } = attributes;
		if (!test) {
			throw new TypeError();
		}

		if (header === falsyBranch) {
			test = t.unaryExpression('!', test);
		}

		attributes.test = null;
		attributes.beforeStatements = [
			t.doWhileStatement(test, t.blockStatement(attributes.beforeStatements)),
		];

		graph.dropDirectedEdge(header, header);

		const edges = graph.outEdges(header);
		if (edges.length !== 1) {
			throw new TypeError();
		}

		graph.setEdgeAttribute(edges[0], 'flowPredicate', true);
	}

	return true;
}

function reduceSimpleIf(graph: ControlFlowGraph) {
	const ifList = graph.reduceNodes((acc, header, {test}) => {
		if (!test) {
			return acc;
		}

		const successors = graph.outNeighbors(header);
		if (successors.length !== 2) {
			throw new TypeError();
		}

		const [left, right] = successors;
		const leftSuccessors = graph.outNeighbors(left);
		const rightSuccessors = graph.outNeighbors(right);

		const [_, truthyBranch] = sortBranch(graph, header, successors);

		let ifTest: t.Expression;
		let consequent: string;
		let alternate: string | null;
		let successor: string | null;

		const leftConsequent = leftSuccessors[0] === right;
		const rightConsequent = rightSuccessors[0] === left;
		const ifElse = leftSuccessors[0] === rightSuccessors[0];

		if (leftConsequent) {
			if (graph.inNeighbors(left).length !== 1) {
				return acc;
			}
			if (leftSuccessors.length !== 1) {
				return acc;
			}

			if (truthyBranch === left) {
				ifTest = test
			} else  {
				ifTest = t.unaryExpression('!', test);
			}

			consequent = left;
			alternate = null;
			successor = right;
		} else if (rightConsequent) {
			if (graph.inNeighbors(right).length !== 1) {
				return acc;
			}
			if (rightSuccessors.length !== 1) {
				return acc;
			}

			if (truthyBranch === right) {
				ifTest = test
			} else {
				ifTest = t.unaryExpression('!', test);
			}

			consequent = right;
			alternate = null;
			successor = left;
		} else if (leftSuccessors.length === 0 && rightSuccessors.length === 0) {
			if (graph.inNeighbors(left).length !== 1) {
				return acc;
			}
			if (graph.inNeighbors(right).length !== 1) {
				return acc;
			}

			ifTest = test;
			successor = null;

			if (truthyBranch === left) {
				consequent = left;
				alternate  = right;
			} else {
				consequent = right;
				alternate  = left;
			}
		} else if (ifElse) {
			if (graph.inNeighbors(left).length !== 1) {
				return acc;
			}
			if (graph.inNeighbors(right).length !== 1) {
				return acc;
			}
			if (leftSuccessors.length !== 1) {
				return acc;
			}
			if (rightSuccessors.length !== 1) {
				return acc;
			}

			ifTest = test;
			[successor] = leftSuccessors;

			if (truthyBranch === left) {
				consequent = left;
				alternate  = right;
			} else {
				consequent = right;
				alternate  = left;
			}
		} else {
			return acc;
		}

		acc.push({
			header,
			test: ifTest,
			consequent,
			alternate,
			successor,
		});
		return acc;
	}, [] as {
		header: string,
		test: t.Expression,
		consequent: string,
		alternate: string | null,
		successor: string | null
	}[]);

	if (ifList.length === 0) {
		return false;
	}

	for (const {header, test, consequent, alternate, successor} of ifList) {
		const headerAttributes = graph.getNodeAttributes(header);
		const consequentStatements = graph.getNodeAttribute(consequent, 'beforeStatements');
		const alternateStatements = (alternate) ? graph.getNodeAttribute(alternate, 'beforeStatements') : null;

		headerAttributes.test = null;
		headerAttributes.beforeStatements.push(
			t.ifStatement(
				test,
				t.blockStatement(consequentStatements),
				alternateStatements ? t.blockStatement(alternateStatements) : null
			)
		);

		graph.dropNode(consequent);
		if (alternate) {
			graph.dropNode(alternate);
		}

		if (successor !== null) {
			graph.mergeEdge(header, successor, { flowPredicate: true });
		}
	}

	return true;
}

export function reduceSimple(graph: ControlFlowGraph) {
	let changed = false;
	do {
		changed = false;
		changed = reduceSequence(graph) || changed;
		changed = reduceSimpleIf(graph) || changed;
		changed = reduceSimpleDoWhile(graph) || changed;
		changed = reduceSimpleWhile(graph) || changed;
	} while (changed);
}
