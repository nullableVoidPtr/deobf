import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';

export default (path: NodePath): boolean => {
	let removed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		IfStatement(path) {
			const test = path.get('test');
			if (!test.isBooleanLiteral()) return;

			const consequent = path.get('consequent');
			const alternate = path.get('alternate');

			let executed: typeof consequent;
			let dead: typeof alternate;
			if (test.node.value) {
				executed = consequent;
				dead = alternate;
			} else if (alternate.hasNode()) {
				executed = alternate;
				dead = consequent;
			} else {
				path.remove();
				removed = true;

				return;
			}

			if (executed.isBlockStatement()) {
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

			dead.remove();

			removed = true;
		},
		ConditionalExpression(path) {
			const test = path.get('test');
			if (!test.isBooleanLiteral()) return;

			const consequent = path.get('consequent');
			const alternate = path.get('alternate');
			if (test.node.value) {
				path.replaceWith(consequent.node);
			} else {
				path.replaceWith(alternate.node);
			}

			removed = true;
		},
	});

	logger.info('Done' + (removed ? ' with changes' : ''));

	return removed;
};
