import { type NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import { getPropertyName, pathAsBinding } from '../../../utils.js';

export function extractScopePattern(path: NodePath | undefined | null) {
	if (!path?.isAssignmentPattern()) return null;

	const scopeParam = path.get('left');
	if (!scopeParam.isIdentifier()) return null;
	const scopeBinding = pathAsBinding(scopeParam);
	if (!scopeBinding) return null;

	const scopeDefault = path.get('right');
	if (!scopeDefault.isObjectExpression()) return null;
	const scopeProperties = scopeDefault.get('properties');
	if (scopeProperties.length !== 1) return null;
	const mainScopeProperty = scopeProperties[0];
	if (!mainScopeProperty.isObjectProperty()) return null;
	const mainScopeInit = mainScopeProperty.get('value');
	if (!mainScopeInit.isObjectExpression() || mainScopeInit.node.properties.length !== 0) return;

	const mainScopeKey = getPropertyName(mainScopeProperty);
	if (mainScopeKey === null) return null;

	return [scopeBinding, mainScopeKey] as const;
}

function extractStateAddition(path: NodePath) {
	if (!path.isBinaryExpression({ operator: '+' })) return null;

	const identifiers = new Set<string>();
	const left = path.get('left');
	if (left.isIdentifier()) {
		identifiers.add(left.node.name);
	} else {
		const subIdentifiers = extractStateAddition(left);
		if (subIdentifiers === null) return null;

		for (const id of subIdentifiers) {
			identifiers.add(id);
		}
	}

	const right = path.get('right');
	if (right.isIdentifier()) {
		identifiers.add(right.node.name);
	} else {
		const subIdentifiers = extractStateAddition(right);
		if (subIdentifiers === null) return null;

		for (const id of subIdentifiers) {
			identifiers.add(id);
		}
	}

	return identifiers;
}

export function extractState(path: NodePath) {
	if (!path.isBinaryExpression({ operator: '!==' })) return;
	const stateIdentifiers = extractStateAddition(path.get('left'));
	if (stateIdentifiers === null) return;

	const right = path.get('right');
	const evalState = right.evaluate();
	if (!evalState.confident) return;
	const stopState = evalState.value;
	if (typeof stopState !== 'number') return;

	return [stateIdentifiers, stopState] as const;
}

export function extractWithScope(path: NodePath, scopeId: string) {
	if (!path.isLogicalExpression({ operator: '||' })) return null;

	const defaultWithScope = path.get('right');
	if (!defaultWithScope.isIdentifier({ name: scopeId })) return null;

	const optionalWithScope = path.get('left');
	if (!optionalWithScope.isMemberExpression()) return null;
	if (!optionalWithScope.get('object').isIdentifier({ name: scopeId })) return null;

	return getPropertyName(optionalWithScope);
}


