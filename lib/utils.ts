import * as t from '@babel/types';
import _traverse, { type Binding, type NodePath } from '@babel/traverse';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (<any>_traverse).default;

export function asSingleStatement(path: NodePath<t.Node | null | undefined>) {
	if (!path.isStatement()) return null;
	if (!path.isBlockStatement()) return path;

	const body = path.get('body');
	const stmt = body.at(0);
	if (stmt?.isReturnStatement()) {
		return stmt;
	} else if (stmt?.isContinueStatement()) {
		return stmt;
	} else if (stmt?.isBreakStatement()) {
		return stmt;
	} else if (body.length === 1) {
		return stmt;
	}

	return null;
}

type HasIdentifierAsId<T extends t.Node> = T extends {id?: t.Node | null | undefined} ? T : never;

export function getVarInitId(path: NodePath<t.Expression>): NodePath<t.Identifier> | null {
	const varDeclPath = path.parentPath;
	if (path.key !== 'init') return null;
	if (!varDeclPath.isVariableDeclarator()) return null;
	
	const id = varDeclPath.get('id');
	if (!id.isIdentifier()) return null;
	
	return id;
}

export function pathAsBinding(path: NodePath<t.Identifier | HasIdentifierAsId<t.Node>>): Binding | null {
	let id: NodePath<t.Identifier>;
	if (path.isIdentifier()) {
		id = path;
	} else {
		const potentialId = path.get('id') as NodePath;
		if (!potentialId.isIdentifier()) return null;

		id = potentialId;
	}

	let binding = path.scope.getBinding(id.node.name);
	if (!binding) return null;

	if (path.isFunctionDeclaration()) {
		if (binding.identifier === id.node) return binding;

		binding = path.scope.parent.getBinding(id.node.name);
		if (binding?.identifier !== id.node) return null;
	}

	return binding || null;
}

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
	args: NodePath<t.Expression>[]
) {
	const params = proxyFunc.get('params');
	if (!params.every((p): p is NodePath<t.Identifier> => p.isIdentifier())) {
		throw new Error('unsupported func args');
	}
	const argMap = new Map<string, t.Expression>();
	(<NodePath<t.Identifier>[]>params).forEach((param, i) => {
		argMap.set(param.node.name, args[i].node);
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
			if (path.parentPath?.isMemberExpression() && path.key === 'property') {
				return;
			}

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
