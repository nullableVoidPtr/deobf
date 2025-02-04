import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import { asSingleStatement, pathAsBinding } from '../../utils.js';

function inlineFunction(concealFunction: NodePath<t.FunctionDeclaration>, objId: string) {
	const switchStmt = asSingleStatement(concealFunction.get('body'));
	if (!switchStmt?.isSwitchStatement()) return;

	const concealBinding = pathAsBinding(concealFunction);
	if (!concealBinding) return;

	const concealMapping = new Map<string, t.Identifier>()
	for (const switchCase of switchStmt.get('cases')) {
		const discriminant = switchCase.get('test');
		if (!discriminant.isStringLiteral()) return;

		const last = switchCase.get('consequent').at(-1);
		if (!last?.isReturnStatement()) return;

		const value = last.get('argument');
		if (!value.isMemberExpression() || !value.get('object').isIdentifier({ name: objId })) return;

		if (value.node.computed) return;
		const property = value.get('property');
		if (!property.isIdentifier()) return;

		concealMapping.set(discriminant.node.value, property.node);
	}

	let missed = false;
	for (const ref of concealBinding.referencePaths) {
		const call = ref.parentPath;
		if (!call?.isCallExpression() || ref.key !== 'callee') {
			missed = true;
			continue;
		}

		const args = call.get('arguments');
		if (args.length < 1) {
			missed = true;
			continue;
		}

		const str = args[0];
		if (!str.isStringLiteral()) {
			missed = true;
			continue;
		}

		const object = concealMapping.get(str.node.value);
		if (!object) {
			missed = true;
			continue;
		}

		call.replaceWith(t.cloneNode(object, true));
	}

	if (!missed) {
		concealFunction.remove();
	}
}

function inlineVar(decl: NodePath<t.VariableDeclarator>, objId: string, isGlobal = false) {
	const varBinding = pathAsBinding(decl);
	if (!varBinding) return;

	for (const ref of varBinding.referencePaths) {
		const parentPath = ref.parentPath;
		if (isGlobal && parentPath?.isMemberExpression() && ref.key === 'object') {
			const property = parentPath.get('property');
			if (property.isIdentifier() && !parentPath.node.computed) {
				parentPath.replaceWith(property.node);

				let usage = parentPath.parentPath;
				if (usage.isLogicalExpression({ operator: '||' }) && parentPath.key === 'left') {
					const obj = usage.get('right');
					if (obj.isIdentifier({ name: property.node.name })) {
						usage = usage.parentPath;
					}
				}

				if (usage.isVariableDeclarator()) {
					inlineVar(usage, property.node.name);
				}

				continue;
			}
		}

		ref.replaceWith(t.identifier(objId));
	}

	decl.remove();
}

export default (path: NodePath): boolean => {
	let changed = false;

	const state = { globalObjFuncs: new Set<Binding>() }
	path.traverse({
		StringLiteral(str) {
			if (str.node.value !== '') return;

			let child: NodePath = str;
			let ancestor = child.parentPath;
			for (const id of ['__proto__', 'constructor', 'name']) {
				if (!ancestor?.isMemberExpression() || child.key !== 'object') return;
				if (!ancestor.get('property').isIdentifier({ name: id })) return;

				child = ancestor;
				ancestor = child.parentPath;
			}

			if (!ancestor?.isCallExpression() || child.listKey !== 'arguments') return;

			const callee = ancestor.get('callee');
			if (!callee.isMemberExpression() || !callee.get('property').isIdentifier({ name: 'push' })) return;

			const func = str.getFunctionParent();
			if (!func?.isFunctionDeclaration()) return;

			const binding = pathAsBinding(func);
			if (binding) this.globalObjFuncs.add(binding);
		}
	}, state);

	const visitedConcealFunctions = new Set<NodePath>();
	for (const binding of state.globalObjFuncs) {
		let missed = false;
		for (const ref of binding.referencePaths) {
			const call = ref.parentPath;
			if (!call?.isCallExpression()) {
				missed = true;
				continue;
			}

			call.replaceWith(t.identifier('globalThis'));
			changed = true;

			let usage = call.parentPath;
			if (usage.isLogicalExpression({ operator: '||' }) && call.key === 'left') {
				const obj = usage.get('right');
				if (obj.isObjectExpression()) {
					usage = usage.parentPath;
				}
			}

			if (usage.isVariableDeclarator()) {
				const usageBinding = pathAsBinding(usage);
				if (usageBinding) {
					for (const ref of usageBinding.referencePaths) {
						if (ref.parentPath?.isMemberExpression() && ref.parentPath.parentPath.isReturnStatement()) {
							const func = ref.getFunctionParent();
							if (!func?.isFunctionDeclaration()) continue;

							if (visitedConcealFunctions.has(func)) continue;
							inlineFunction(func, usageBinding.identifier.name);
						}
					}
				}

				inlineVar(usage, 'globalThis', true);
			}
		}

		if (!missed) {
			binding.path.remove();			
		}
	}

	return changed;
};