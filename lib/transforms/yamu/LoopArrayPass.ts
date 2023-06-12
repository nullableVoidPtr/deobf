import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';

const reverseIdx = (arrNum: number, offset: number) => (indices: number[]): number => (indices.reduce((a, b) => {
	let d = b - a * offset;
	while (d < 0) {
		d += arrNum;
	}
	return d;
}) * offset) % arrNum

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		VariableDeclarator(path) {
			const id = path.get('id');
			if (!id.isIdentifier()) return;

			const binding = path.scope.getBinding(id.node.name);
			if (!binding) return;

			const init = path.get('init');
			if (!init.isCallExpression()) return;

			const args = init.get('arguments');
			if (args.length != 2) return;
			if (!args[0].isNumericLiteral()) return;
			if (!args[1].isNumericLiteral()) return;

			const resolver = reverseIdx(args[0].node.value, args[1].node.value);

			const toReplace: [NodePath<t.MemberExpression>, t.NumericLiteral][] = []
			for (const ref of binding.referencePaths) {
				const indices: number[] = [];
				const ancestry = ref.getAncestry();
				let i = 1;
				for (; i < ancestry.length; i++) {
					const current = ancestry[i];
					if (!current.isMemberExpression()) break;
					if (current.key == 'property') break;

					const property = current.get('property');
					if (!property.isNumericLiteral()) return;

					indices.push(property.node.value);
				}

				if (indices.length === 0) return;

				const previous = ancestry[i - 1];
				if (!previous.isMemberExpression()) return;

				toReplace.push([previous, t.numericLiteral(resolver(indices))])
			}

			for (const [ref, value] of toReplace) {
				ref.replaceWith(value);
			}

			path.remove()
			changed = true;

			path.stop();
		}
	});

	return changed;
};