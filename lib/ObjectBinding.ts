import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import { dereferencePathFromBinding } from './utils.js';

export class PropertyBinding {
	objectBinding: Binding;
	objectIsArray: boolean;

	key?: string | number;
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
		objectIsArray = false,
	}: {
		objectBinding: Binding;
		property: NodePath;
		computed: boolean;
		path?: NodePath;
		objectIsArray?: boolean
	}) {
		this.path = path;
		this.valuePath = path;
		this.objectBinding = objectBinding;
		this.objectIsArray = objectIsArray

		this.isPrivate = property.isPrivateName();
		this.key = PropertyBinding.resolveProperty(property, computed, this.objectIsArray);
	}

	dereference(reference: NodePath) {
		const directRef = this.referenceMap.get(reference);
		if (!directRef) return;

		dereferencePathFromBinding(this.objectBinding, directRef);
	}

	static resolveProperty(property: NodePath, computed: boolean, objectIsArray = false): string | number | undefined {
		if (property.isPrivateName()) {
			return property.node.id.name;
		}

		if (property.isIdentifier()) {
			if (computed) {
				const resolved = property.resolve();
				if (!resolved || resolved === property) return;

				return PropertyBinding.resolveProperty(resolved, computed, objectIsArray);
			} else {
				return property.node.name;
			}
		}
		

		const state = property.evaluate();
		if (state.confident) {
			const { value } = state;
			switch (typeof value) {
			case 'string':
				if (objectIsArray) {
					const index = parseInt(value);
					if (value === index.toString()) {
						return index;
					}
					return value;
				}
				return value;
			case 'bigint':
				if (objectIsArray) {
					if (value < 0 || value > 2 ** 32 - 2) {
						return value.toString();
					}
					return Number(value);
				}
				return value.toString();
			case 'number':
				if (objectIsArray) {
					if (value < 0 || value > 2 ** 32 - 2) {
						return value.toString();
					}
					return value;
				}
				return value.toString();
			case 'undefined':
				return 'undefined';
			case 'boolean':
				return value.toString();
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

export function crawlProperties(objectBinding: Binding, objectIsArray = false): {
	properties: Map<string | number, PropertyBinding>;
	unresolvedBindings: Set<PropertyBinding>;
	unresolvedReferences: Set<NodePath<t.MemberExpression | t.OptionalMemberExpression>>;
	objectReferences: Set<NodePath>;
} {
	const properties = new Map<string | number, PropertyBinding>();
	const unresolvedBindings = new Set<PropertyBinding>();
	const unresolvedReferences = new Set<NodePath<t.MemberExpression | t.OptionalMemberExpression>>();
	const objectReferences = new Set<NodePath>();

	if (!objectBinding.constant) {
		const isVarConst = objectBinding.kind === 'var' && objectBinding.constantViolations.length === 1 && objectBinding.constantViolations[0] == objectBinding.path;
		if (!isVarConst) {
			return {
				properties,
				unresolvedBindings,
				unresolvedReferences,
				objectReferences,
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
					objectIsArray,
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
		if ((!memberExpr?.isMemberExpression() && !memberExpr?.isOptionalMemberExpression()) || directRef.key != 'object') {
			objectReferences.add(directRef);
			continue;
		}

		const property = (<NodePath<t.MemberExpression | t.OptionalMemberExpression>>memberExpr).get('property');
		const computed = memberExpr.is('computed');
		const key = PropertyBinding.resolveProperty(property, computed, objectIsArray);

		const usage = memberExpr.parentPath;
		let isConstantViolation = false;
		if (usage.isAssignmentExpression() && memberExpr.key == 'left') {
			isConstantViolation = true;
		} else if (usage.isUpdateExpression() && memberExpr.key == 'argument') {
			isConstantViolation = true;
		} else if (usage.isUnaryExpression({operator: 'delete'}) && memberExpr.key == 'argumment') {
			isConstantViolation = true;
		}

		if (key !== undefined) {
			if (isConstantViolation) {
				let binding = properties.get(key);
				if (!binding) {
					binding = new PropertyBinding({
						objectBinding,
						property,
						computed,
						path: usage,
						objectIsArray,
					});
					properties.set(key, binding);
				}

				binding.constantViolationMap.set(usage, memberExpr)
			} else {
				let binding = properties.get(key);
				if (!binding) {
					binding = new PropertyBinding({
						objectBinding,
						property,
						computed,
						objectIsArray,
					});
					properties.set(key, binding);
				}

				binding.referenceMap.set(memberExpr, directRef);
			}
		} else {
			if (isConstantViolation) {
				const binding = new PropertyBinding({
					objectBinding,
					property,
					computed,
					path: usage,
					objectIsArray,
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
		objectReferences,
	};
}