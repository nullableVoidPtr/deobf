import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { type Indexer } from '../jso/StringArrayPass/decoder.js';
import { getPropertyName } from '../../utils.js';

export const x = (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		AssignmentExpression(assign) {
			if (assign.node.operator !== '=') return;

			const assignee = assign.get('left');
			if (!assignee.isIdentifier()) return;

			const right = assign.get('right');
			let value = right;
			if (!value.isUnaryExpression({ operator: '~', prefix: true })) return;
			value = value.get('argument');
			if (!value.isUnaryExpression({ operator: '~', prefix: true })) return;
			value = value.get('argument');
			if (!value.isCallExpression()) return;

			const callee = value.get('callee');
			if (!callee.isMemberExpression()) return;
			if (!callee.get('object').isStringLiteral({ value: '0x' })) return;

			const property = callee.get('property');
			if (!property.isStringLiteral({ value: 'concat' }) && !property.isIdentifier({ value: 'concat' })) return;

			const args = value.get('arguments');
			if (args.length !== 1) return;

			if (!args[0].isIdentifier({ name: assignee.node.name })) return;

			right.replaceWith(t.binaryExpression(
				'-',
				args[0].node,
				t.numericLiteral(0),
			));
			changed = true;
		},
	});

	return changed;
}

export default function hexIndexer(decoder: NodePath<t.Function>): Indexer {
	const firstArg = decoder.get('params.0');
	if (!firstArg.isIdentifier()) {
		throw new Error('unexpected non-Identifier as first parameter');
	}

	let offset = 0;
	const binding = decoder.scope.getOwnBinding(firstArg.node.name); 
	if (!binding) {
		throw new Error('undefined index parameter');
	}

	if (binding.constantViolations.length > 1) {
		throw new Error('multiple constant violations');
	}

	const write = binding.constantViolations[0];
	if (write.isAssignmentExpression({ operator: '=' })) {
		const valuePath = write.get('right');
		if (valuePath.isBinaryExpression({ operator: '-' })) {
			const sourcePath = valuePath.get('left');
			if (!sourcePath.isIdentifier({ name: binding.identifier.name })) {
				throw new Error('unexpected constant violation value');
			}

			const shiftPath = valuePath.get('right');
			if (!shiftPath.isNumericLiteral()) {
				throw new Error('unexpected constant violation value');
			}

			offset = -shiftPath.node.value;
		} else if (valuePath.isUnaryExpression({ operator: '~', prefix: true })) {
			let current = valuePath.get('argument');
			if (!current.isUnaryExpression({ operator: '~', prefix: true })) {
				throw new Error('unexpected constant violation value');
			}
			current = current.get('argument');
			if (!current.isCallExpression()) {
				throw new Error('unexpected constant violation value');
			}

			const concat = current.get('callee')

			if (!concat.isMemberExpression()) {
				throw new Error('unexpected constant violation value');
			}
			if (getPropertyName(concat) !== 'concat') {
				throw new Error('unexpected constant violation value');
			}
			if (!concat.get('object').isStringLiteral({ value: '0x' })) {
				throw new Error('unexpected constant violation value');
			}

			const args = current.get('arguments');
			if (args.length !== 1) {
				throw new Error('unexpected constant violation value');
			}

			const append = args[0];

			let sliceIndex = 0;
			if (append.isCallExpression()) {
				const slice = append.get('callee');
				if (!slice.matchesPattern(`${firstArg.node.name}.slice`)) {
					throw new Error('unexpected constant violation value');
				}

				const args = append.get('arguments');
				if (args.length !== 1) {
					throw new Error('unexpected constant violation value');
				}

				const sliceIndexPath = args[0];
				if (!sliceIndexPath.isNumericLiteral()) {
					throw new Error('unexpected constant violation value');
				}

				sliceIndex = sliceIndexPath.node.value;
			} else if (!append.isIdentifier({ name: firstArg.node.name })) {
				throw new Error('unexpected constant violation value');
			}


			return (index: number | string) => Number('0x' + (index as string).slice(sliceIndex))
		} else {
			throw new Error('unexpected constant violation value');
		}
	} else if (write.isAssignmentExpression({ operator: '-=' })) {
		const shiftPath = write.get('right');
		if (!shiftPath.isNumericLiteral()) {
			throw new Error('unexpected constant violation value');
		}

		offset = -shiftPath.node.value;
	} else {
		throw new Error('unexpected constant violation');
	}

	return (index: number | string) => Number(index) + offset;
}
