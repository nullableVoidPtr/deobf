import { type NodePath } from '@babel/traverse';
import { type Expression } from '@babel/types';
import type { FlatControlFlow } from './controlFlow.js';
import { getPropertyName } from '../../../utils.js';

export interface ComplexTest {
	stateId: string;
	notEqual: [string, number][];
	offset: number;
}

export interface ScopeTest {
	object: string[];
	property: string;
	offset: number;
}

export type BlockTest = number | ComplexTest | ScopeTest | null | NodePath<Expression>;

export function extractScopeTest(this: FlatControlFlow, path: NodePath): ScopeTest | null {
	if (!path.isBinaryExpression({ operator: '+' })) return null;

	const offsetPath = path.get('right');
	const evalState = offsetPath.evaluate();
	if (!evalState.confident) return null;
	const offset = evalState.value;
	if (typeof offset !== 'number') return null;

	let objectPath = path.get('left');
	const object: string[] = [];
	let property: string | undefined;
	while (true) {
		let currentProperty: string;
		if (objectPath.isMemberExpression()) {
			const property = getPropertyName(objectPath);
			if (property === null) {
				return null;
			}

			currentProperty = property;
			objectPath = objectPath.get('object');
		} else if (objectPath.isIdentifier()) {
			currentProperty = objectPath.node.name;
			if (!property) {
				property = currentProperty;
			} else {
				object.unshift(currentProperty);
			}

			break;
		} else {
			return null;
		}

		if (!property) {
			property = currentProperty;
		} else {
			object.unshift(currentProperty);
		}
	}

	if (!property) return null;

	return {
		object,
		property,
		offset,
	}
}

export function extractComplexTest(this: FlatControlFlow, path: NodePath): ComplexTest | null {
	let offsetExpr = path;
	let deconflictConditions: NodePath<Expression> | undefined;
	if (path.isLogicalExpression({ operator: '&&' })) {
		offsetExpr = path.get('right');
		deconflictConditions = path.get('left');		
	}

	if (!offsetExpr.isBinaryExpression({ operator: '-' })) return null;

	const statePath = offsetExpr.get('left');
	if (!statePath.isIdentifier()) return null;

	const stateId = statePath.node.name;
	if (!this.stateParams.includes(stateId)) return null;

	const evalState = offsetExpr.get('right').evaluate();
	if (!evalState.confident) return null;
	const offset = evalState.value;
	if (typeof offset !== 'number') return null;

	const notEqual: [string, number][] = [];

	if (!deconflictConditions) {
		return {
			stateId,
			notEqual,
			offset,
		};
	}

	let condition = deconflictConditions;

	const extractInequality = (inequality: NodePath): [string, number] | null => {
		if (!inequality.isBinaryExpression({ operator: '!=' })) return null;
		const id = inequality.get('left');
		if (!id.isIdentifier()) return null;
		if (!this.stateParams.includes(id.node.name)) return null;

		const evalState = inequality.get('right').evaluate();
		if (!evalState.confident) return null;
		const testValue = evalState.value;
		if (typeof testValue !== 'number') return null;

		return [id.node.name, testValue];
	}

	while (true) {
		let inequalityPath = condition;
		let baseCase = false;
		if (condition.isLogicalExpression({ operator: '&&' })) {
			inequalityPath = condition.get('right');
			condition = condition.get('left');
		} else {
			baseCase = true;
		}

		const inequality = extractInequality(inequalityPath);
		if (!inequality) return null;
		
		notEqual.unshift(inequality);

		if (baseCase) break;
	}

	return {
		stateId,
		notEqual,
		offset,
	}
}