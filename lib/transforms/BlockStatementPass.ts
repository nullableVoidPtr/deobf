import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../logging.js';

export default (path: NodePath): boolean => {
	const changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		Statement(path) {
			if (path.isBlockStatement()) return;

			const { parentPath } = path;
			if (parentPath?.isIfStatement()) {
				if (path.key == 'consequent' || path.key == 'alternate') {
					path.replaceWith(t.blockStatement([path.node]));
					return;
				}
			}

			if (
				parentPath?.isWithStatement() ||
				parentPath?.isLoop()
			) {
				if (path.key == 'body') {
					path.replaceWith(t.blockStatement([path.node]));
					return;
				}
			}
		},
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};
