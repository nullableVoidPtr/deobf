import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../logging.js';

function fixupMember(path: NodePath<t.Method | t.Property>) {
	const key = path.get('key');
	if (!key.isStringLiteral()) return false;
	if (!t.isValidIdentifier(key.node.value)) return false;

	key.replaceWith(t.identifier(key.node.value));

	if (path.node.type !== 'ClassPrivateProperty') {
		path.node.computed = false;
	}

	return true;
}

export default (path: NodePath): boolean => {
	let replaced = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		MemberExpression(path) {
			const property = path.get('property');
			if (!property.isStringLiteral()) return;
			if (property.node.value.length > 21) return;
			if (!t.isValidIdentifier(property.node.value)) return;

			replaced = true;
			property.replaceWith(t.identifier(property.node.value));
			path.node.computed = false;
		},
		Method(path) {
			replaced = fixupMember(path) || replaced;
		},
		Property(path) {
			replaced = fixupMember(path) || replaced;
		},
	});

	logger.info('Done' + (replaced ? ' with changes' : ''));

	return replaced;
};
