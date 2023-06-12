import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

const FIRST_CHECKS: Partial<Record<t.Node['type'], (ancestor: NodePath, current: NodePath) => boolean>> = {
	AssignmentExpression: (parentPath: NodePath, path: NodePath) => (
		path.key === 'right' &&
		!(parentPath.get('left') as NodePath).isMemberExpression()
	),
	AssignmentPattern: (parentPath: NodePath, path: NodePath) => (
		path.key === 'right' &&
		!(parentPath.get('left') as NodePath).isMemberExpression()
	),
	UnaryExpression: (_: NodePath, path: NodePath) => (
		path.key === 'argument'
	),
	BinaryExpression: (_: NodePath, path: NodePath) => (
		path.key === 'left'
	),
	UpdateExpression: (_: NodePath, path: NodePath) => (
		path.key === 'argument'
	),
	ConditionalExpression: (_: NodePath, path: NodePath) => (
		path.key === 'test'
	),
	MemberExpression: (_: NodePath, path: NodePath) => (
		path.key === 'object'
	),
	OptionalMemberExpression: (_: NodePath, path: NodePath) => (
		path.key === 'object'
	),
	CallExpression: (_: NodePath, path: NodePath) => (
		path.key === 'callee'
	),
	OptionalCallExpression: (_: NodePath, path: NodePath) => (
		path.key === 'callee'
	),
	NewExpression: (_: NodePath, path: NodePath) => (
		path.key === 'callee'
	),
	ClassExpression: (_: NodePath, path: NodePath) => (
		path.key === 'superClass'
	),
	YieldExpression: (_: NodePath, path: NodePath) => (
		path.key === 'argument'
	),
	AwaitExpression: (_: NodePath, path: NodePath) => (
		path.key === 'argument'
	),
};

const STATEMENTS: Partial<Record<t.Node['type'], NodePath['key']>> = {
	ExpressionStatement: 'expression',
	ReturnStatement: 'argument',
	ThrowStatement: 'argument',
	IfStatement: 'test',
	SwitchStatement: 'discriminant',
	ForStatement: 'init',
	ForInStatement: 'right',
	ForOfStatement: 'right',
	WhileStatement: 'test',
	WithStatement: 'object',
	ClassDeclaration: 'superClass',
	ExportDefaultDeclaration: 'declaration',
}

export const repeatUntilStable = true;

export default (path: NodePath): boolean => {
	const changed = false;
	path.traverse({
		SequenceExpression(path) {
			const { parentPath } = path;
			const firstExpressions = path.get('expressions');
			const lastExpression = firstExpressions.pop();
			if (!lastExpression) {
				throw new Error();
			}
			const lastExpressionNode = lastExpression.node;

			const newStatements = firstExpressions.map(p => t.expressionStatement(p.node));

			if (
				parentPath?.isVariableDeclarator() &&
				parentPath.listKey === 'declarations' &&
				parentPath.key === 0 &&
				path.key === 'init'
			) {
				parentPath.insertBefore(newStatements);
				path.replaceWith(lastExpressionNode);
			} else if (
				parentPath?.isForStatement() &&
				path.key == 'update'
			) {
				const body = parentPath.get('body');
				if (body.isBlockStatement()) {
					body.node.body.push(...newStatements);
				} else {
					body.replaceWith(
						t.blockStatement([body.node, ...newStatements])
					);
				}
				path.replaceWith(lastExpressionNode);
			} else if (
				parentPath?.isDoWhileStatement() &&
				path.key === 'test'
			) {
				const body = parentPath.get('body');
				if (body.isBlockStatement()) {
					body.node.body.push(...newStatements);
				} else {
					body.replaceWith(
						t.blockStatement([body.node, ...newStatements])
					);
				}
				path.replaceWith(lastExpressionNode);
			}

			const isIndirectEval = lastExpression.isIdentifier({ name: 'eval' });

			let current: NodePath = path;
			let ancestor = parentPath;
			while (!ancestor.isStatement()) {
				if (!ancestor.parentPath) return;
				if (!FIRST_CHECKS?.[ancestor.type]?.(ancestor, current)) return;

				current = ancestor;
				ancestor = ancestor.parentPath;
			}

			if (STATEMENTS?.[ancestor.type] === path.key) {
				ancestor.insertBefore(newStatements);
				path.replaceWith(isIndirectEval
					? t.sequenceExpression([
						t.numericLiteral(0),
						lastExpressionNode
					])
					: lastExpressionNode
				);
			}
		},
		// ensure binding references are updated
		Scopable: {
			exit(path) {
				path.scope.crawl();
			}
		}
	});

	return changed;
};
