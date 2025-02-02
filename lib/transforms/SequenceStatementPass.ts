import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';

type CheckFunction<T extends t.Node> = (
	ancestor: NodePath<T>,
	current: NodePath<t.ParentMaps[T['type']]>,
) => boolean;

function makeChildKeyCheck<T extends t.Node>(key: string): CheckFunction<T> {
	return (_, path) => path.key === key;
}

function makeListContainerCheck<T extends t.Node>(listKey: string): CheckFunction<T> {
	return (_, path) => {
		if (path.listKey !== listKey) return false;

		return path.getAllPrevSiblings().every(p => p.isPure());
	}
}

function binExprCheck<T extends t.BinaryExpression | t.AssignmentExpression>(
	parentPath: NodePath<T>,
	path: NodePath<t.ParentMaps[T['type']]>
) {
	if (path.key === 'left') return true;

	if (path.key === 'right') {
		return (<typeof path>parentPath.get('left')).isPure();
	}

	return false;
}

function memberExprCheck<T extends t.MemberExpression | t.OptionalMemberExpression>(
	parentPath: NodePath<T>,
	path: NodePath<t.ParentMaps[T['type']]>
) {
	if (path.key === 'object') return true;
	if (path.key === 'property') {
		return (<typeof path>parentPath.get('object')).isPure();
	}

	return false;
}

function callLikeCheck(_: NodePath, path: NodePath) {
	if (path.key === 'callee') return true;
	if (path.listKey === 'arguments') {
		return path.getAllPrevSiblings().every(p => p.isPure());
	}

	return false;
}

const FIRST_CHECKS = {
	ArrayExpression: makeListContainerCheck('elements'),
	ObjectExpression: makeListContainerCheck('properties'),
	AssignmentExpression: binExprCheck,
	UnaryExpression: makeChildKeyCheck('argument'),
	BinaryExpression: binExprCheck,
	UpdateExpression: makeChildKeyCheck('argument'),
	ConditionalExpression: (parentPath, path) => {
		if (path.key === 'test') return true;
		if (!parentPath.get('test').isPure()) return false;

		if (path.key === 'consequent') return true;
		if (!parentPath.get('consequent').isPure()) return false;

		if (path.key === 'alternate') return true;

		return false;
	},
	MemberExpression: memberExprCheck,
	OptionalMemberExpression: memberExprCheck,
	CallExpression: callLikeCheck,
	OptionalCallExpression: callLikeCheck,
	NewExpression: callLikeCheck,
	ClassExpression: makeChildKeyCheck('superClass'),
	YieldExpression: makeChildKeyCheck('argument'),
	AwaitExpression: makeChildKeyCheck('argument'),
} satisfies {
	[Type in t.Expression['type']]?: CheckFunction<Extract<t.Node, { type: Type }>>;
} as {
	[Type in t.Expression['type']]?: (ancestor: NodePath, current: NodePath) => boolean;
};

type ExtractExprs<T extends t.Node> = {
	[K in keyof T as [t.Expression] extends [T[K]] ? K : [t.Expression[]] extends [T[K]] ? K : never]: K;
};

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] }

const STATEMENTS: {
	[Type in t.Statement['type']]?: string;
} = {
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
} satisfies Partial<OmitNever<{
	[Type in t.Statement['type']]: keyof ExtractExprs<Extract<t.Node, { type: Type }>>;
}>>;

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
				parentPath.parentPath.insertBefore(newStatements);
				path.replaceWith(lastExpressionNode);
				return;
			} else if (
				(
					parentPath?.isForStatement() &&
					path.key == 'update'
				) || (
					parentPath?.isDoWhileStatement() &&
					path.key === 'test'
				)
			) {
				const body = (<NodePath<t.ForStatement | t.DoWhileStatement>>parentPath).get('body');
				if (body.isBlockStatement()) {
					body.node.body.push(...newStatements);
				} else {
					body.replaceWith(
						t.blockStatement([body.node, ...newStatements])
					);
				}
				path.replaceWith(lastExpressionNode);
				return;
			}

			const isIndirectEval = lastExpression.isIdentifier({ name: 'eval' });

			let current: NodePath = path;
			let ancestor: NodePath = parentPath;
			while (ancestor.isExpression()) {
				if (!ancestor.parentPath) return;
				if (!FIRST_CHECKS?.[ancestor.type]?.(ancestor, current)) return;

				current = ancestor;
				ancestor = ancestor.parentPath;
			}

			if (!ancestor.isStatement()) {
				throw new Error();
			}

			if (STATEMENTS?.[ancestor.type] === current.key) {
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
