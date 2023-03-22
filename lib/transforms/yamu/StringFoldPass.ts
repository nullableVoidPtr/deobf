import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		CallExpression(path) {
			const calleePath = path.get('callee');
			if (calleePath.matchesPattern('String.fromCharCode') || calleePath.matchesPattern('window.String.fromCharCode')) {
				const argPaths = path.get('arguments');
				if (!argPaths.every((a) => a.isNumericLiteral())) {
					return;
				}
				const args = (argPaths as NodePath<t.NumericLiteral>[]).map(a => a.node.value);
				path.replaceWith(t.stringLiteral(String.fromCharCode(...args)));
				changed = true;
			}
		},
		BinaryExpression: {
			exit(path) {
				const left = path.get('left');
				const right = path.get('right');
				if (!left.isStringLiteral() || !right.isStringLiteral()) {
					return;
				}
				const value = left.node.value + right.node.value;
				path.replaceWith(t.stringLiteral(value))
				changed = true;
			}
		}
	});

	return changed;
}