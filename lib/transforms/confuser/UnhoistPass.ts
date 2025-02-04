import * as t from '@babel/types';
import { Binding, type NodePath } from '@babel/traverse';
import { pathAsBinding } from '../../utils.js';
import { extractHoistedDecl } from './utils.js';

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

export function unhoistFunctionParams(func: NodePath<t.FunctionDeclaration | t.FunctionExpression>, funcLength: number) {
	const extraParams = func.get('params').slice(funcLength);

	const body = func.get('body').get('body');
	for (const stmt of body) {
		const hoist = extractHoistedDecl(stmt);
		if (!hoist) return;

		const { param, value } = hoist;
		if (!extraParams.includes(param)) return;

		if (stmt.isIfStatement() && value.isFunctionExpression()) {
			stmt.replaceWith(t.functionDeclaration(
				t.cloneNode(param.node, true),
				value.node.params,
				value.node.body,
				value.node.generator,
				value.node.async,
			));
		} else {
			stmt.replaceWith(t.variableDeclaration(
				'var',
				[t.variableDeclarator(
					t.cloneNode(param.node, true),
					value.node,
				)],
			));
		}

		param.remove();
	}
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		FunctionDeclaration(func) {
			const params = func.get('params');
			if (params.some(p => p.isRestElement())) return;

			const binding = pathAsBinding(func);
			if (!binding?.constant) return;

			let maxArgLength = -1;
			for (const ref of binding.referencePaths) {
				const call = ref.parentPath;
				if (!(call?.isCallExpression() || call?.isNewExpression()) || ref.key !== 'callee') return;

				const args = (<NodePath<t.CallExpression | t.NewExpression>>call).get('arguments');
				if (args.some(a => a.isSpreadElement())) return;
				if (maxArgLength < args.length) {
					maxArgLength = args.length;
				}
			}

			if (maxArgLength === -1 || maxArgLength > params.length) return;

			unhoistFunctionParams(func, maxArgLength);
		},
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
				if (binding.constantViolations.length === 0) continue;

				const assignment = binding.constantViolations[0];
				if (binding.constantViolations.length !== 1) {
					const stmt = assignment.parentPath;
					if (!stmt?.isExpressionStatement()) continue;

					const prior = stmt.getAllPrevSiblings();
					if (!prior.some(p => p === decn)) continue;

					if (prior.some(p => binding.referencePaths.some(p.isAncestor) || binding.constantViolations.some(p.isAncestor))) continue;
				}

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