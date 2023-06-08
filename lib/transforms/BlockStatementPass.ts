import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	const changed = false;
	path.traverse({
		Statement(path) {
			if (path.isBlockStatement()) {
				return;
			}

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

	return changed;
};
