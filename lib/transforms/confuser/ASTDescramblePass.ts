import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { asSingleStatement, pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		FunctionDeclaration(func) {
			const params = func.get('params');
			if (params.length !== 0) return;

			const idPath = func.get('id');
			if (!idPath.isIdentifier()) return;

			const assignStmt = asSingleStatement(func.get('body'));
			let reassignment: NodePath | null = null;
			if (assignStmt) {
				if (!assignStmt.isExpressionStatement()) return;

				const expr = assignStmt.get('expression');
				if (!expr.isAssignmentExpression({ operator: '=' })) return;

				if (!expr.get('left').isIdentifier({ name: idPath.node.name })) return;

				const innerFunc = expr.get('right');
				if (innerFunc.isFunctionExpression()) {
					if (innerFunc.get('body.body').length !== 0) return;
				} else if (innerFunc.isArrowFunctionExpression()) {
					if (!innerFunc.get('body').isPure()) return;
				} else {
					return;
				}

				reassignment = expr;
			} else /* if (body.length !== 0) */ {
				return;
			}

			const binding = pathAsBinding(func);
			if (!binding) return;

			if (!binding.constant) {
				if (binding.constantViolations.length !== 1) return;
				if (binding.constantViolations[0] !== reassignment) return;
			}

			let missed = false;
			for (const ref of binding.referencePaths) {
				const parentPath = ref.parentPath;
				if (ref.key === 'right') {
					const { parentPath } = ref;
					if (!parentPath?.isBinaryExpression() || parentPath.node.operator !== 'in') {
						throw new Error('unexpected reference to empty function');
					}

					parentPath.replaceWith(t.booleanLiteral(false));
					continue;
				} else if (!parentPath?.isCallExpression() || ref.key !== 'callee') {
					throw new Error('unexpected reference to empty function');
				}


				const stmt = parentPath.parentPath;
				if (!stmt.isStatement()) {
					missed = true;
					continue;
				}

				const args = parentPath.get('arguments');
				if (args.length === 0) {
					stmt.remove();
				} else {
					try {
						// TODO: replace eagerly
						stmt.replaceWithMultiple(args.map(p => {
							if (!p.isExpression()) {
								throw new Error('unexpected non-Expression in sequence statement');
							}

							return t.expressionStatement(p.node);
						}));
					} catch {
						missed = true;
						continue;
					}
				}

				changed = true;
			}

			if (!missed) {
				func.remove();
				changed = true;
			}
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};