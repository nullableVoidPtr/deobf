import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		FunctionDeclaration(dummyFunc) {
			if (dummyFunc.node.params.length !== 0) return;
			if (dummyFunc.node.body.body.length !== 0) return;

			const binding = pathAsBinding(dummyFunc);
			if (!binding) return;

			if (!binding.constant) return;

			let missed = false;
			for (const ref of binding.referencePaths) {
				const opaquePredicate = ref.parentPath;
				if (!opaquePredicate?.isBinaryExpression({ operator: 'in' }) || ref.key !== 'right') {
					missed = true;
					continue;
				}

				opaquePredicate.replaceWith(t.booleanLiteral(false));
			}

			if (!missed) {
				dummyFunc.remove();
				changed = true;
			}
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};