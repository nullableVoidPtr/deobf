import * as t from '@babel/types';
import _traverse, { Binding, NodePath } from '@babel/traverse';
import { dereferencePathFromBinding, inlineProxyCall, Stack } from '../../../utils.js';
import LiteralFoldPass from '../../LiteralFoldPass.js';
import { DecoderInfo } from './decoder.js';


function resolveVarWrapper(decoder: Binding, reference: NodePath): NodePath[] {
	const binding = reference.scope.getOwnBinding(
		(<t.VariableDeclarator & { id: t.Identifier }>(
			reference.parent
		)).id.name
	);

	if (!binding?.constant) {
		return [];
	}

	const newRefs: NodePath[] = [];
	for (const wrapperRef of binding.referencePaths) {
		wrapperRef.replaceWith(decoder.identifier);
		decoder.reference(wrapperRef);
		newRefs.push(wrapperRef);
	}

	dereferencePathFromBinding(decoder, reference);
	binding.path.remove();
	binding.scope.removeBinding(binding.identifier.name);

	return newRefs;
}

function resolveFuncWrapper(decoder: Binding, reference: NodePath): NodePath[] {
	const ancestry = reference.getAncestry();
	if (ancestry.length < 3) {
		return [];
	}
	if (!ancestry[2].isReturnStatement()) {
		return [];
	}

	const proxyPath = reference.scope.path; //refPath.ancestry
	let proxyId: string | null = null;
	let proxyFunc: NodePath<t.Function> | null = null;
	if (proxyPath.isFunctionDeclaration()) {
		proxyId = proxyPath.node.id?.name || null;
		proxyFunc = proxyPath;
		if (!proxyId) {
			throw new Error('call wrapper without identifier');
		}
	} else if (proxyPath.isFunctionExpression()) {
		const varPath = proxyPath.parentPath;
		if (varPath?.isVariableDeclarator() && proxyPath.key == 'init') {
			const idPath = varPath.get('id');
			if (idPath.isIdentifier()) {
				proxyId = idPath.node.name;
			}
			proxyFunc = proxyPath;
		}
	}

	if (!proxyId || !proxyFunc) {
		throw new Error('unexpected call wrapper');
	}

	const binding = proxyPath.parentPath?.scope.getOwnBinding(
		proxyId
	);

	if (!binding?.constant) {
		return [];
	}

	const newRefs: NodePath[] = [];
	for (const wrapperRef of binding.referencePaths) {
		if (wrapperRef.key !== 'callee') {
			throw new Error(
				'unexpected reference to wrapper'
			);
		}

		const wrapperCall =
			wrapperRef.parentPath as NodePath<t.CallExpression>;
		const args = wrapperCall.node.arguments;
		if (
			!args.every((a): a is t.Expression =>
				t.isExpression(a)
			)
		) {
			throw new Error('unexpected call args');
		}
		inlineProxyCall(wrapperCall, proxyFunc, args);
		LiteralFoldPass(wrapperCall);
		decoder.reference(wrapperCall.get('callee'));
		newRefs.push(wrapperCall.get('callee'));
	}

	dereferencePathFromBinding(decoder, reference);
	binding.path.remove();
	binding.scope.removeBinding(binding.identifier.name);

	return newRefs;
}

export default function resolveWrappers(decoders: Map<Binding, DecoderInfo>) {
	for (const decoder of decoders.keys()) {
		const callRefPathStack = Stack.from(decoder.referencePaths);
		for (const callRefPath of callRefPathStack) {
			let newRefs: NodePath[];
			if (callRefPath.key === 'init') {
				newRefs = resolveVarWrapper(decoder, callRefPath)
			} else if (callRefPath.key === 'callee') {
				newRefs = resolveFuncWrapper(decoder, callRefPath)
			} else {
				continue;
			}

			callRefPathStack.push(...newRefs);
		}
	}
}