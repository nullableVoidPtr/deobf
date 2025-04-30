import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { isLooselyConstantBinding, pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		VariableDeclarator(decl) {
			const value = decl.get('init');

			if (!value.isLogicalExpression({ operator: '||' })) return;
			if (!value.get('left').matchesPattern('Math.imul')) return;
			const polyfillRef = value.get('right');

			const binding = pathAsBinding(decl);
			if (!isLooselyConstantBinding(binding)) return;
			for (const ref of binding.referencePaths) {
				ref.replaceWith(t.memberExpression(
					t.identifier('Math'),
					t.identifier('imul'),
					false,
					false,
				));

				changed = true;
			}
			binding.path.remove();

			if (polyfillRef.isIdentifier()) {
				const polyfillBinding = pathAsBinding(polyfillRef);
				if (!polyfillBinding?.path.isFunctionDeclaration()) return;
				if (polyfillBinding.references !== 1) return;

				polyfillBinding.path.remove();
				changed = true;
			}
		}
	});

	return changed;
}