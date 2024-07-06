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

export class PropertyBinding {
	objectBinding: Binding;
	key?: string;
	isPrivate: boolean;
	path?: NodePath;
	valuePath?: NodePath;
	referenceMap: Map<NodePath, NodePath> = new Map();
	constantViolationMap: Map<NodePath, NodePath> = new Map();

	constructor({
		objectBinding,
		property,
		computed,
		path,
	}: {
		objectBinding: Binding;
		property: NodePath;
		computed: boolean;
		path?: NodePath;
	}) {
		this.path = path;
		this.valuePath = path;
		this.objectBinding = objectBinding;

		this.isPrivate = property.isPrivateName();
		this.key = PropertyBinding.resolveProperty(property, computed);
	}

	dereference(reference: NodePath) {
		const directRef = this.referenceMap.get(reference);
		if (!directRef) return;

		dereferencePathFromBinding(this.objectBinding, directRef);
	}

	static resolveProperty(property: NodePath, computed: boolean): string | undefined {
		if (property.isPrivateName()) {
			return property.node.id.name;
		}

		if (property.isIdentifier()) {
			if (computed) {
				const resolved = property.resolve();
				if (!resolved) return;

				return PropertyBinding.resolveProperty(resolved, computed);
			} else {
				return property.node.name;
			}
		}

		const state = property.evaluate();
		if (state.confident) {
			const { value } = state;
			switch (typeof value) {
			case 'string':
				return value;
			case 'bigint':
			case 'number':
				return value.toString();
			case 'undefined':
				return 'undefined';
			case 'object':
				if (value === null) {
					return 'null';
				}
			}
		}

		return;
	}

	get scope() {
		return this.objectBinding.scope;
	}

	get referencePaths(): Set<NodePath> {
		return new Set(this.referenceMap.keys())
	}

	get references() {
		return this.referenceMap.size;
	}
	
	get referenced() {
		return this.references > 0;
	}
	
	get constantViolations(): Set<NodePath> {
		return new Set(this.constantViolationMap.keys())
	}

	get constant() {
		return this.constantViolationMap.size === 0;
	}
}

export function crawlProperties(objectBinding: Binding): {
	properties: Map<string, PropertyBinding>;
	unresolvedBindings: Set<PropertyBinding>;
	unresolvedReferences: Set<NodePath>;
} {
	const properties = new Map<string, PropertyBinding>();
	const unresolvedBindings = new Set<PropertyBinding>();
	const unresolvedReferences = new Set<NodePath>();

	if (!objectBinding.constant) {
		const isVarConst = objectBinding.kind === 'var' && objectBinding.constantViolations.length === 1 && objectBinding.constantViolations[0] == objectBinding.path;
		if (!isVarConst) {
			return {
				properties,
				unresolvedBindings,
				unresolvedReferences,
			};
		}
	}

	const { path } = objectBinding;
	if (path.isVariableDeclarator()) {
		const objExpr = path.get('init');
		if (objExpr.isObjectExpression()) {
			for (const property of objExpr.get('properties')) {
				let key: NodePath;
				if (property.isObjectMethod()) {
					key = property.get('key');
				} else if (property.isObjectProperty()) {
					key = property.get('key');
				} else {
					continue;
				}

				const binding = new PropertyBinding({
					objectBinding,
					property: key,
					computed: property.is('computed'),
					path: property,
				});

				if (binding.key) {
					properties.set(binding.key, binding);
				} else {
					unresolvedBindings.add(binding);
				}
			}
		}
	}

	for (const directRef of objectBinding.referencePaths) {
		const memberExpr = directRef.parentPath;
		if (!memberExpr?.isMemberExpression() || directRef.key != 'object') continue;

		const property = memberExpr.get('property');
		const computed = memberExpr.is('computed');
		const key = PropertyBinding.resolveProperty(property, computed);

		const reference = memberExpr.parentPath;
		let isConstantViolation = false;
		if (reference.isAssignmentExpression() && memberExpr.key == 'left') {
			isConstantViolation = true;
		} else if (reference.isUpdateExpression() && memberExpr.key == 'argument') {
			isConstantViolation = true;
		} else if (reference.isUnaryExpression({operator: 'delete'}) && memberExpr.key == 'argumment') {
			isConstantViolation = true;
		}

		if (key) {
			if (isConstantViolation) {
				let binding = properties.get(key);
				if (!binding) {
					binding = new PropertyBinding({
						objectBinding,
						property,
						computed,
						path: reference,
					});
					properties.set(key, binding);
					continue;
				}

				binding.constantViolationMap.set(reference, directRef)
			} else {
				let binding = properties.get(key);
				if (!binding) {
					binding = new PropertyBinding({
						objectBinding,
						property,
						computed,
					});
					properties.set(key, binding);
					continue;
				}

				binding.referenceMap.set(memberExpr, directRef);
			}
		} else {
			if (isConstantViolation) {
				const binding = new PropertyBinding({
					objectBinding,
					property,
					computed,
					path: reference,
				});

				unresolvedBindings.add(binding);
			} else {
				unresolvedReferences.add(memberExpr);
			}
		}
	}

	return {
		properties,
		unresolvedBindings,
		unresolvedReferences,
	};
}