import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../../logging.js';
import Base91Pass from './Base91Pass.js';
import DecompressPass from './DecompressPass.js';

export default (path: NodePath) => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	changed = DecompressPass(path) || changed;
	changed = Base91Pass(path) || changed;

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
}