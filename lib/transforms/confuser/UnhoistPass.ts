import * as t from '@babel/types';
import { Binding, type NodePath } from '@babel/traverse';

function getAssignedIdentifiers(pattern: NodePath<t.Pattern>): Set<string> {
	const queue: NodePath[] = [pattern];
	const ids = new Set<string>();

	while (queue.length) {
		const id = queue.pop();
		if (!id) continue;

		if (id.isArrayPattern()) {
			for (const element of id.get('elements')) {
				if (!element.hasNode()) continue;
				queue.push(element);
			}
			continue;
		}
		
		if (id.isAssignmentPattern()) {
			queue.push(id.get('left'));
			continue;
		}

		if (id.isObjectPattern()) {
			queue.push(...id.get('properties'));
			continue;
		}

		if (id.isObjectProperty()) {
			queue.push(id.get('value'));
			continue;
		}

		if (id.isRestElement()) {
			queue.push(id.get('argument'));
			continue;
		}

		if (id.isIdentifier()) {
			ids.add(id.node.name);
			continue;
		}
	}

	return ids;
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		VariableDeclaration(decn) {
			if (decn.node.kind !== 'var') return;
			for (const decl of decn.get('declarations')) {
				if (decl.has('init')) return;
			}

			const patternAssigns = new Map<NodePath<t.AssignmentExpression>, Binding[]>();
			for (const decl of decn.get('declarations')) {
				const idPath = decl.get('id');
				if (!idPath.isIdentifier()) continue;

				const binding = decn.scope.getBinding(idPath.node.name);
				if (!binding) continue;
				if (binding.constantViolations.length !== 1) continue;

				const assignment = binding.constantViolations[0];
				if (assignment.scope !== decn.scope) continue;
				if (!assignment.isAssignmentExpression({ operator: '=' })) continue;

				const lval = assignment.get('left');
				if (!lval.isIdentifier({ name: idPath.node.name }))  {
					if (lval.isPattern()) {
						let patternBindings = patternAssigns.get(assignment);
						if (!patternBindings) {
							patternAssigns.set(assignment, patternBindings = []);
						}

						patternBindings.push(binding);
					}
					continue;
				}
				const stmt = assignment.parentPath;
				if (!stmt.isExpressionStatement()) continue;

				const value = assignment.get('right');

				const referenced = binding.referencePaths.some(
					ref => ref.scope === decn.scope && !assignment.willIMaybeExecuteBefore(ref)
				);
				if (referenced) continue;

				stmt.replaceWith(
					t.variableDeclaration(
						'var',
						[
							t.variableDeclarator(
								t.identifier(idPath.node.name),
								t.cloneNode(value.node, true),
							),
						],
					)
				);

				decl.remove();
				changed = true;
			}

			for (const [assignment, bindings] of patternAssigns.entries()) {
				const stmt = assignment.parentPath;
				if (!stmt.isExpressionStatement()) continue;

				const pattern = assignment.get('left');
				if (!pattern.isPattern()) continue;

				const identifiers = bindings.map(binding => binding.identifier.name);
				const assigned = getAssignedIdentifiers(pattern);
				if (![...assigned].every(id => identifiers.includes(id))) continue;

				stmt.replaceWith(
					t.variableDeclaration(
						'var',
						[t.variableDeclarator(
							pattern.node,
							assignment.node.right,
						)],
					),
				);
				for (const binding of bindings) {
					binding.path.remove();
				}
			}
		}
	});

	return changed;
};