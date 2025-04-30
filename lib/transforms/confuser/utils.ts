import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { asSingleStatement, getPropertyName, pathAsBinding } from '../../utils.js';

function isTimestamp(expr: NodePath): boolean {
	if (expr.isCallExpression()) {
		const callee = expr.get('callee');
		if (callee.matchesPattern('Date.now')) {
			return true;
		}

		if (callee.isMemberExpression()) {
			if (getPropertyName(callee) === 'getTime') {
				const object = callee.get('object');
				if (object.isNewExpression()) {
					if (object.get('callee').isIdentifier({ name: 'Date' })) {
						return true;
					}
				}
			}
		}
	}

	return false;
}

export function extractDateCheck(expr: NodePath<t.Expression>): {
	type: 'start' | 'end',
	value: number,
} | null | undefined {
	if (expr.isBinaryExpression()) {
		if (!['<', '>', '<=', '>='].includes(expr.node.operator)) return null;

		const left = expr.get('left');
		const right = expr.get('right');

		let value;
		let type: 'start' | 'end';
		if (isTimestamp(left)) {
			switch (expr.node.operator) {
			case '>':
			case '>=':
				type = 'end';
				break;
			case '<':
			case '<=':
				type = 'start';
				break;
			default:
				return undefined;
			}
			if (!right.isNumericLiteral()) return undefined;
			value = right.node.value;
		} else if (isTimestamp(right)) {
			switch (expr.node.operator) {
			case '>':
			case '>=':
				type = 'start';
				break;
			case '<':
			case '<=':
				type = 'end';
				break;
			default:
				return undefined;
			}
			if (!left.isNumericLiteral()) return undefined;
			value = left.node.value;
		} else {
			return null;
		}


		return {
			type,
			value
		};
	}

	return null;
}

export function extractDomainLock(expr: NodePath<t.Expression>): string | null | undefined {
	if (expr.isUnaryExpression({ operator: '!', prefix: true })) {
		const call = expr.get('argument');
		if (!call.isCallExpression()) return null;

		if (!call.get('arguments.0')?.matchesPattern('window.location.href')) return null;

		const callee = call.get('callee');
		if (!callee.isMemberExpression()) return null;
		if (getPropertyName(callee) !== 'test') return null;

		const regexp = callee.get('object');
		if (!regexp.isNewExpression()) return null;
		if (!regexp.get('callee').isIdentifier({ name: 'RegExp' })) return null;

		const pattern = regexp.get('arguments.0');
		if (pattern.isStringLiteral()) {
			return pattern.node.value;
		}

		return undefined;
	}

	return null;
}

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
		
		if (stmt.isDebuggerStatement()) return false;
		if (stmt.isIfStatement() && !stmt.get('alternate').hasNode()) {
			const test = stmt.get('test');
			if (extractDateCheck(test) !== null || extractDomainLock(test) !== null) {
				return false;
			}
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
