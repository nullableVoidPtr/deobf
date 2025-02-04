import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { pathAsBinding } from '../../utils.js';

export function filterBody(body: NodePath<t.Statement>[]) {
	return body.filter(stmt => {
		if (stmt.isFunctionDeclaration()) {
			const binding = pathAsBinding(stmt);
			if (!binding) return true;

			if (!binding.referenced) return false;

			return binding.referencePaths.every(ref => ref.getAncestry().some(
				ancestor => (
					ancestor === binding.path ||
					ancestor.removed ||
					!ancestor.hasNode()
				)
			))
		}

		return true;
	});
}
