import { type Binding, type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { asSingleStatement, pathAsBinding } from '../../utils.js';

function isProperlyReferenced(binding: Binding) {
	if (binding.referencePaths.every(ref => ref.getAncestry().some(
		ancestor => (
			ancestor === binding.path ||
			ancestor.removed ||
			!ancestor.hasNode()
		)
	))) return false;

	for (const ref of binding.referencePaths) {
		const unary = ref.parentPath;
		if (!unary?.isUnaryExpression({ operator: '!', prefix: true })) continue;
		const ifStmt = unary.parentPath;
		if (!ifStmt.isIfStatement() || ifStmt.node.alternate) continue;

		if (binding.referencePaths.every(ref => ref.getAncestry().some(
			ancestor => (
				ancestor === binding.path ||
				ancestor === ifStmt ||
				ancestor.removed ||
				!ancestor.hasNode()
			)
		))) {
			ifStmt.remove();
			return false;
		}
	}

	return true;
}

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	const state = { deadFunctions: new Set<Binding>() };
	path.traverse({
		IfStatement(path) {
			const test = path.get('test');
			if (!test.isBooleanLiteral()) return;

			const consequent = path.get('consequent');
			const alternate = path.get('alternate');

			let executed: typeof consequent | undefined;
			let dead: typeof alternate;
			if (test.node.value) {
				executed = consequent;
				dead = alternate;
			} else if (alternate.hasNode()) {
				executed = alternate;
				dead = consequent;
			} else {
				dead = consequent;
			}

			if (executed) {
				if (executed?.isBlockStatement()) {
					path.replaceWithMultiple(executed.node.body);
				} else {
					path.replaceWith(executed.node);
				}

				const { parentPath } = path;
				if (parentPath.isBlockStatement()) {
					const firstReturn = parentPath.get('body').find(s => s.isReturnStatement());
					const after = firstReturn?.getAllNextSiblings();
					if (after && after?.length > 0) {
						for (const stmt of after) {
							stmt.remove();
						}
					}
				}

				return;
			}

			const deadStmt = asSingleStatement(dead);
			if (deadStmt?.isExpressionStatement()) {
				const deadCall = deadStmt.get('expression');
				if (deadCall.isCallExpression()) {
					const callee = deadCall.get('callee');
					if (callee.isIdentifier()) {
						const binding = pathAsBinding(callee);
						if (binding) {
							this.deadFunctions.add(binding);
						}
					}
				}
			}

			path.remove();

			changed = true;
		},
		LogicalExpression(path) {
			const left = path.get('left');
			const right = path.get('right');
			if (left.isBooleanLiteral({ value: true }) && path.node.operator === '&&') {
				path.replaceWith(right.node);
				changed = true;
			}

		},
	}, state);

	for (const binding of state.deadFunctions) {
		if (isProperlyReferenced(binding)) continue;

		binding.path.remove();
		changed = true;
	}

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};
