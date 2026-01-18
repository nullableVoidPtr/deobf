import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { pathAsBinding } from '../../utils.js';

function extractArrayFromIIFE(call: NodePath<t.Expression | null | undefined>): NodePath<t.ArrayExpression> | null {
	if (!call.isCallExpression()) return null;

	const callee = call.get('callee');
	if (!callee.isFunctionExpression()) return null;

	let expr: NodePath<t.ReturnStatement['argument']> | null = null;
	const body = callee.get('body');
	if (body.isExpression()) {
		expr = body;
	} else if (body.isBlockStatement()) {
		const stmts = body.get('body');
		if (stmts.length !== 1) return null;
		const [ret] = stmts;
		if (!ret.isReturnStatement()) return null;
		expr = ret.get('argument');
	}

	if (!expr?.isArrayExpression()) return null;

	return expr;
}

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		SpreadElement: {
			exit(path) {
				const { parentPath } = path;
				if (!parentPath.isArrayExpression()) return;
				if (typeof path.key !== 'number') return;

				const argument = path.get('argument');
				if (argument.isArrayExpression()) {
					path.replaceWithMultiple(argument.node.elements as readonly t.Node[]);
					return;
				}

				const expr = extractArrayFromIIFE(argument);
				if (!expr) return;

				path.replaceWithMultiple(expr.node.elements as readonly t.Node[]);
				changed = true;
			},
		},
		CallExpression: {
			exit(path) {
				const callee = path.get('callee');
				if (!callee.isMemberExpression()) return;
				if (!callee.get('property').isIdentifier({ name: 'concat' })) return;

				const startArray = callee.get('object');
				if (!startArray.isArrayExpression()) return;

				const args = path.get('arguments');
				if (args.length !== 1) return;

				const iife = args[0];
				if (!iife.isExpression()) return;

				const nextArray = extractArrayFromIIFE(iife);
				if (!nextArray) return;

				const newArray = t.cloneNode(startArray.node, true);
				newArray.elements = newArray.elements.concat(nextArray.node.elements);

				path.replaceWith(newArray);
				changed = true;
			},
		},
	});
	path.traverse({
		ArrayExpression(path) {
			const elements = path.get('elements');
			if (elements.length === 0) return;
			const [first, ...rest] = elements;
			if (!first.isIdentifier()) return;
			if (!rest.every(e => e.isStringLiteral())) return;

			const binding = first.scope.getBinding(first.node.name);
			if (!binding) return;

			const versionPath = binding.path;
			if (!versionPath.isVariableDeclarator()) return;
			const versionInit = versionPath.get('init');
			if (!versionInit.isStringLiteral()) return;
			first.replaceWith(versionInit.node);
			changed = true;

			if (binding.references !== 1) return;
			
			if (binding.constantViolations.length > 0) {
				const assign = binding.constantViolations[0];
				if (!assign.isAssignmentExpression({ operator: '=' })) return;

				/*
				const right = assign.get('right');
				if (!right.isIdentifier()) return;
				*/

				const stmt = assign.parentPath;
				if (!stmt.isExpressionStatement()) return;

				let ifStmt = stmt.parentPath;
				if (ifStmt.isBlockStatement()) {
					if (ifStmt.node.body.length > 1) return;

					ifStmt = ifStmt.parentPath;
				}

				if (!ifStmt.isIfStatement()) return;
				const test = ifStmt.get('test');
				if (!test.isIdentifier()) return;
				const testBinding = pathAsBinding(test);
				if (!testBinding?.path.isFunction()) return;

				ifStmt.remove();
			}

			versionPath.remove();
		},
		VariableDeclarator(path) {
			const init = path.get('init');
			const expr = extractArrayFromIIFE(init);
			if (!expr) return;

			init.replaceWith(expr.node);
			changed = true;
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};