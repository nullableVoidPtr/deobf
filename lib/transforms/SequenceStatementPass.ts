import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

type CheckFunction<T extends t.Node> = (
	ancestor: NodePath<T>,
	current: NodePath<t.ParentMaps[T['type']]>,
) => boolean;

const FIRST_CHECKS = {
	ArrayExpression: (_, path) => {
		if (path.listKey === 'elements') {
			return path.getAllPrevSiblings().every(p => p.isPure());
		}

		return false;
	},
	ObjectExpression: (_, path) => {
		if (path.listKey === 'properties') {
			return path.getAllPrevSiblings().every(p => p.isPure());
		}

		return false;
	},
	AssignmentExpression: (parentPath, path) => {
		if (path.key === 'left') return true;

		if (path.key === 'right') {
			return parentPath.get('left').isPure();
		}

		return false;
	},
	UnaryExpression: (_, path) => (
		path.key === 'argument'
	),
	BinaryExpression: (parentPath, path) => {
		if (path.key === 'left') return true;
	
		if (path.key === 'right') {
			return parentPath.get('left').isPure();
		}

		return false;
	},
	UpdateExpression: (_, path) => (
		path.key === 'argument'
	),
	ConditionalExpression: (parentPath, path) => {
		if (path.key === 'test') return true;
		if (!parentPath.get('test').isPure()) return false;

		if (path.key === 'consequent') return true;
		if (!parentPath.get('consequent').isPure()) return false;

		if (path.key === 'alternate') return true;
		return false;
	},
	MemberExpression: (parentPath, path) => {
		if (path.key === 'object') return true;
		if (path.key === 'property') {
			return parentPath.get('object').isPure();
		}

		return false;
	},
	OptionalMemberExpression: (parentPath, path) => {
		if (path.key === 'object') return true;
		if (path.key === 'property') {
			return parentPath.get('object').isPure();
		}

		return false;
	},
	CallExpression: (_, path) => {
		if (path.key === 'callee') return true;
		if (path.listKey === 'arguments') {
			return path.getAllPrevSiblings().every(p => p.isPure());
		}

		return false;
	},
	OptionalCallExpression: (_, path) => {
		if (path.key === 'callee') return true;
		if (path.listKey === 'arguments') {
			return path.getAllPrevSiblings().every(p => p.isPure());
		}

		return false;
	},
	NewExpression: (_, path) => {
		if (path.key === 'callee') return true;
		if (path.listKey === 'arguments') {
			return path.getAllPrevSiblings().every(p => p.isPure());
		}

		return false;
	},
	ClassExpression: (_, path) => (
		path.key === 'superClass'
	),
	YieldExpression: (_, path) => (
		path.key === 'argument'
	),
	AwaitExpression: (_, path) => (
		path.key === 'argument'
	),
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
