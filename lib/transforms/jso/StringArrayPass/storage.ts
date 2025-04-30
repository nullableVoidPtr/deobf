import * as t from '@babel/types';
import _traverse, { type Binding, type NodePath } from '@babel/traverse';
import { isLooselyConstantBinding, isRemoved, pathAsBinding } from '../../../utils.js';
import { crawlProperties } from '../../../ObjectBinding.js';

export function fixCFStorage(path: NodePath) {
	const state = { bindings: new Set<Binding>() };
	path.traverse({
		MemberExpression(memberExpr) {
			if (memberExpr.node.computed) return;
			const object = memberExpr.get('object');
			if (!object.isIdentifier()) return;
			const binding = pathAsBinding(object);
			if (!binding) return;

			this.bindings.add(binding);
		}
	}, state);

	if (state.bindings.size === 0) return;

	for (const binding of state.bindings) {
		if (!isLooselyConstantBinding(binding)) continue;

		const objectBinding = crawlProperties(binding);
		if (objectBinding.objectReferences.size > 0) continue;
		if (objectBinding.unresolvedReferences.size > 0) continue;
		if (objectBinding.unresolvedBindings.size > 0) continue;


		if (objectBinding.properties.values().some(property => 
			!property.valuePath?.isStringLiteral() && !property.valuePath?.isNumericLiteral()
		)) continue;
		for (const propertyBinding of objectBinding.properties.values()) {
			for (const ref of propertyBinding.referencePaths) {
				if (isRemoved(ref)) continue;

				ref.replaceWith(t.cloneNode(propertyBinding.valuePath!.node, true));
				propertyBinding.dereference(ref);
			}
		}

	}

	for (const binding of state.bindings) {
		if (binding.referenced) continue;

		binding.path.remove();
	}
}
