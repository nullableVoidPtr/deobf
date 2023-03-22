import * as t from '@babel/types';
import _traverse, { Binding, NodePath } from '@babel/traverse';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (<any>_traverse).default;

export function dereferencePathFromBinding(binding: Binding, reference: NodePath): boolean {
	const refIndex = binding.referencePaths.indexOf(reference);
	if (refIndex !== -1) {
		binding.referencePaths.splice(refIndex, 1);
		binding.dereference();
		return true;
	}

	return false;
}

export function inlineProxyCall(
	callExpr: NodePath<t.CallExpression>,
	proxyFunc: NodePath<t.Function>,
	args: t.Expression[]
) {
	const params = proxyFunc.get('params');
	if (!params.every((p): p is NodePath<t.Identifier> => p.isIdentifier())) {
		throw new Error('unsupported func args');
	}
	const argMap = new Map<string, t.Expression>();
	(<NodePath<t.Identifier>[]>params).forEach((param, i) => {
		argMap.set(param.node.name, args[i]);
	});
	let returnExp: t.Expression;
	const body = proxyFunc.get('body');
	if (body.isBlockStatement()) {
		const statements = body.get('body');
		if (statements.length !== 1) {
			throw new Error('Abnormal proxy function (body not one statement)');
		}
		const stmt = statements[0];
		if (!stmt.isReturnStatement()) {
			throw new Error(
				'Abnormal proxy function (only statement not a return)'
			);
		}
		const retExpr = stmt.get('argument');
		if (!retExpr.isExpression()) {
			throw new Error('Abnormal proxy function (return value is undefined)');
		}
		returnExp = t.cloneNode(retExpr.node);
	} else if (body.isExpression()) {
		returnExp = t.cloneNode(body.node);
	} else {
		throw new Error('Abnormal proxy function (unknown return expression)');
	}

	traverse(returnExp, {
		noScope: true,
		Identifier(path: NodePath<t.Identifier>) {
			const name = argMap.get(path.node.name);
			if (name) {
				path.replaceWith(name);
				path.skip();
			}
		},
	});

	callExpr.replaceWith(returnExp);
}

export class Stack<T> {
	#array: T[] = [];

	push(...v: T[]) {
		this.#array.push(...v)
	}

	pop(): T | undefined {
		return this.#array.pop();
	}

	get size(): number {
		return this.#array.length;
	}

	#next(): IteratorResult<T> {
		if (this.size === 0) {
			return {
				done: true,
				value: undefined,
			};
		}


		return {
			done: false,
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			value: this.pop()!,
		}
	}

	[Symbol.iterator](): Iterator<T> {
		return {
			next: this.#next.bind(this)
		}
	}

	static from<T>(vs: T[]) {
		const queue = new Stack<T>();
		queue.push(...vs);
		return queue;
	}
}