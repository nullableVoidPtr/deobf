import { type NodePath } from '@babel/traverse';
import { FunctionDeclaration } from '@babel/types';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		Function(path) {
			if (path.node.params.length > 0) {
				path.get('body').skip();
			}
		},
		VariableDeclarator(path) {
			const func = path.getFunctionParent();
			if (!func?.isFunction() || func.node.params.length > 0) return;
			if (path.getStatementParent()?.parentPath === func) return;
			
			const pattern = path.get('id');
			if (!pattern.isArrayPattern()) return;
			const params: NodePath<FunctionDeclaration['params'][number]>[] = [];
			for (const p of pattern.get('elements')) {
				if (!p.isIdentifier() && !p.isRestElement() && !p.isPattern()) return;
				params.push(p);
			}
			if (!params.every(p => p.isPattern() || p.isRestElement() || p.isIdentifier())) return;
			if (!path.get('init').isIdentifier({ name: 'arguments' })) return;

			const state = { impure: false };
			pattern.traverse({
				AssignmentPattern(path) {
					if (path.get('right').isPure()) return;

					this.impure = true;
					path.stop();
				},
			}, state);

			if (state.impure) return;
			func.node.params = params.map(p => p.node);
			path.remove();

			changed = true;
		},
	});

	return changed;
}