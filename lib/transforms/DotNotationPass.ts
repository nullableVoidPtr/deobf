import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	let replaced = false;
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
			const key = path.get('key');
			if (!key.isStringLiteral()) return;
			if (!t.isValidIdentifier(key.node.value)) return;

			replaced = true;
			key.replaceWith(t.identifier(key.node.value));
			path.node.computed = false;
		},
		Property(path) {
			const key = path.get('key');
			if (!key.isStringLiteral()) return;
			if (!t.isValidIdentifier(key.node.value)) return;

			replaced = true;
			key.replaceWith(t.identifier(key.node.value));

			if (path.node.type !== 'ClassPrivateProperty') {
				path.node.computed = false;
			}
		},
	});
	return replaced;
};
