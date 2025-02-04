import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		VariableDeclarator(decl) {
			const idPath = decl.get('id');
			if (!idPath.isIdentifier()) return;

			const init = decl.get('init');
			if (!init.isArrayExpression()) return;

			let literals: NodePath<t.Expression>[];
			try {
				literals = init.get('elements').map(e => {
					if (e.isUnaryExpression({ operator: 'void', prefix: true }) && e.get('argument').isNumericLiteral()) {
						return e;
					} else if (e.isIdentifier({name: 'undefined' })) {
						return e;
					} else if (!e.isLiteral()) {
						throw new Error('unexpected non-literal');
					}

					return e;
				})
			} catch (e) {
				path.skip();
				return;
			}

			if (literals.length === 0) return;

			const binding = decl.scope.getBinding(idPath.node.name);
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