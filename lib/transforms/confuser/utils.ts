import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { asSingleStatement, pathAsBinding } from '../../utils.js';

export function filterBody(body: NodePath<t.Statement>[]) {
	return body.filter(stmt => {
		if (stmt.isFunctionDeclaration()) {
			const binding = pathAsBinding(stmt);
			if (!binding) return true;

			if (!binding.referenced) return false;

			return !binding.referencePaths.every(ref => ref.getAncestry().some(
				ancestor => (
					ancestor === binding.path ||
					ancestor.removed ||
					!ancestor.hasNode()
				)
			))
		}

		return true;
	});
}

export function extractHoistedDecl(path: NodePath): {
	param: NodePath<t.Identifier>;
	stmt: NodePath<t.Statement>;
	value: NodePath<t.Expression>;
} | null {
	const func = path.getFunctionParent();

	const body = func?.get('body');
	if (!func || !body?.isBlockStatement()) return null;

	const simpleParams = new Map<string, NodePath<t.Identifier>>();
	for (const p of func?.get('params') ?? []) {
		if (!p.isIdentifier()) continue;

		simpleParams.set(p.node.name, p);
	}

	if (simpleParams.size === 0) return null;

	if (func.getData('originalParams', null) === null) {
		func.setData('originalParams', func.node.params.map(
			p => t.cloneNode(p, true),
		));
	}

	let assignee: NodePath | null = null;
	let value: NodePath | null = null;
	let assign: NodePath | null = null;
	let stmt: NodePath | null = null;
	let ifStmt: NodePath<t.IfStatement> | null = null;

	if (path.isIfStatement()) {
		if (path.get('alternate').hasNode()) return null;

		const test = path.get('test');
		if (!test.isUnaryExpression({ operator: '!', prefix: true })) return null;

		assignee = test.get('argument');

		stmt = asSingleStatement(path.get('consequent')) ?? null;

		ifStmt = path;
	} else if (path.isStatement()) {
		stmt = path;
	} else if (path.isAssignmentExpression({ operator: '=' })) {
		assign = path;
	} else if (path.parentPath?.isAssignmentExpression({ operator: '=' })) {
		assign = path.parentPath;
		switch (path.key) {
		case 'left':
			assignee = path;
			break;
		case 'right':
			value = path;
			break;
		default:
			return null;
		}
	} else {
		return null;
	}

	stmt ??= assign?.parentPath ?? null;
	if (!stmt?.isExpressionStatement()) return null;

	const expression = stmt.get('expression');
	assign ??= expression;
	if (assign !== expression) return null;

	if (!assign?.isAssignmentExpression({ operator: '=' })) return null;

	assignee ??= assign.get('left');
	if (!assignee.isIdentifier()) return null;
	if (!assign.get('left').isIdentifier({ name: assignee.node.name })) return null;

	const param = simpleParams.get(assignee.node.name);
	if (!param) return null;

	value ??= assign.get('right');
	if (!value.isExpression()) return null;

	if (ifStmt) {
		if (!value.isFunctionExpression()) return null;
		return {
			param,
			stmt: ifStmt,
			value,
		}
	}

	return {
		param,
		stmt,
		value,
	}
}
