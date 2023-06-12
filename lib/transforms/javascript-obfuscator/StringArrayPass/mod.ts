import * as t from '@babel/types';
import _traverse, { Binding, NodePath } from '@babel/traverse';
import { dereferencePathFromBinding } from '../../../utils.js';
import findStringArrayCandidates from './array.js';
import findDecoders, { DecoderInfo } from './decoder.js';
import resolveWrappers from './wrapper.js';
import analyseRotators from './rotator.js';

function removeDecoders(decoders: Map<Binding, DecoderInfo>) {
	for (const [binding, { arrayBinding }] of decoders) {
		if (!arrayBinding.path.removed) {
			arrayBinding.path.remove();
			arrayBinding.scope.removeBinding(arrayBinding.identifier.name);
		}

		for (const [otherBinding, _] of decoders) {
			for (const reference of [...binding.referencePaths]) {
				if (!otherBinding.path.isAncestor(reference)) continue;

				dereferencePathFromBinding(binding, reference);
			}
		}
		binding.path.remove();
		binding.scope.removeBinding(binding.identifier.name);
	}

} 

function replaceDecoderCalls(decoders: Map<Binding, DecoderInfo>) {
	for (const [decoderBinding, { decoder }] of decoders) {
		for (const decoderRef of decoderBinding.referencePaths) {
			if (decoderRef.key !== 'callee') continue;

			const callPath = decoderRef.parentPath;
			if (!callPath?.isCallExpression()) continue;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const args: any[] = [];
			for (const literal of callPath.get('arguments')) {
				const state = literal.evaluate();
				if (state.confident) {
					args.push(state.value);
				} else {
					throw new Error('unexpected arg in call to decoder');
				}
			}
			callPath.replaceWith(t.stringLiteral(decoder(...args)));
		}
	}
}

export default (treePath: NodePath): boolean => {
	const candidates = findStringArrayCandidates(treePath);
	if (candidates === null) {
		return false;
	}

	const decoders = findDecoders(candidates);
	if (decoders === null) {
		return false;
	}

	resolveWrappers(decoders);
	analyseRotators(decoders);

	removeDecoders(decoders);
	replaceDecoderCalls(decoders);

	return true;
};