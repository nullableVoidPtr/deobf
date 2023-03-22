import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		CallExpression(path) {
			const calleePath = path.get('callee');
			if (!calleePath.isSequenceExpression()) {
				return;
			}
			const seqExprPaths = calleePath.get('expressions');
			if (seqExprPaths.length !== 2) {
				return;
			}
			if (!seqExprPaths[0].isNumericLiteral({value: 1})) {
				return;
			}
			if (!seqExprPaths[1].isIdentifier({name: 'eval'})) {
				return;
			}

			const argPaths = path.get('arguments');
			if (argPaths.length !== 1 || argPaths[0].isStringLiteral({value: 'this'})) {
				return;
			}

			path.replaceWith(t.identifier('window'));
			changed = true;
		},
	});

	return changed;
}