import { NodePath } from '@babel/traverse';

export default (path: NodePath): boolean => {
	let removed = false;
	path.traverse({
		IfStatement(path) {
			const test = path.get('test');
			if (!test.isBooleanLiteral()) return;

			const consequent = path.get('consequent');
			const alternate = path.get('alternate');
			if (test.node.value) {
				if (consequent.isBlockStatement()) {
					path.replaceWithMultiple(consequent.node.body);
				} else {
					path.replaceWith(consequent.node);
				}

				const { parentPath } = path;
				if (parentPath.isBlockStatement()) {
					const firstReturn = parentPath.get('body').find(s => s.isReturnStatement());
					const after = firstReturn?.getAllNextSiblings();
					if (after && after?.length > 0) {
						for (const stmt of after) {
							stmt.remove();
						}
					}
				}

				alternate.remove();
			} else if (alternate.node != null){
				if (alternate.isBlockStatement()) {
					path.replaceWithMultiple(alternate.node.body);
				} else {
					path.replaceWith(alternate.node);
				}

				const { parentPath } = path;
				if (parentPath.isBlockStatement()) {
					const firstReturn = parentPath.get('body').find(s => s.isReturnStatement());
					const after = firstReturn?.getAllNextSiblings();
					if (after && after?.length > 0) {
						for (const stmt of after) {
							stmt.remove();
						}
					}
				}

				consequent.remove();
			} else {
				path.remove();
			}

			removed = true;
		},
		ConditionalExpression(path) {
			const test = path.get('test');
			if (!test.isBooleanLiteral()) return;

			const consequent = path.get('consequent');
			const alternate = path.get('alternate');
			if (test.node.value) {
				path.replaceWith(consequent.node);
			} else {
				path.replaceWith(alternate.node);
			}

			removed = true;
		},
		Scopable(path) {
			path.scope.crawl();
		}
	});

	return removed;
};
