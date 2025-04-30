import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { isUndefined, pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		VariableDeclarator(decl) {
			const init = decl.get('init');
			if (!init.isArrayExpression()) return;

			let literals: NodePath<t.Expression>[];
			try {
				literals = init.get('elements').map(e => {
					if (e.isExpression() && isUndefined(e)) {
						return e;
					} else if (!e.isLiteral()) {
						throw new Error('unexpected non-literal');
					}

					return e;
				})
			} catch (_) {
				path.skip();
				return;
			}

			if (literals.length === 0) return;

			decl.scope.crawl();
			const binding = pathAsBinding(decl);
			if (!binding?.constant) return;

			let missed = false;
			for (const ref of binding.referencePaths) {
				const memberExpr = ref.parentPath;
				if (!memberExpr?.isMemberExpression()) {
					missed = true;
					continue;
				}

				if ((memberExpr.parentPath.isAssignmentExpression() || memberExpr.parentPath.isUpdateExpression()) && memberExpr.key === 'left') {
					missed = true;
					continue;
				}

				const property = memberExpr.get('property');
				if (!property.isNumericLiteral()) {
					missed = true;
					continue;
				}

				const index = property.node.value;

				memberExpr.replaceWith(
					t.cloneNode(
						literals[index].node,
						true,
					),
				);

				changed = true;
			}

			if (!missed) {
				decl.remove();
				changed = true;
			}
		}
	});

	return changed;
};