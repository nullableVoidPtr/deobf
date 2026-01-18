import { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import globalLogger, { getPassName } from '../../logging.js';
import { asSingleStatement, dereferencePathFromBinding, getCallSites, getParentingCall, getPropertyName, isLooselyConstantBinding, isRemoved, pathAsBinding } from '../../utils.js';

const DEFAULT_REPLACEMENT_REGEX = / |\n|;|,|\{|\}|\(|\)|\.|\[|\]/g;

// src: https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
function cyrb(str: string, seed = 0) {
	let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
	for (let i = 0, ch; i < str.length; i++) {
		ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

function extractCache(value: NodePath, expectedObject?: string) {
	if (!value.isLogicalExpression({ operator: '||' })) return null;

	const cache = value.get('left');
	const assign = value.get('right');

	if (!cache.isMemberExpression()) return null;
	const object = cache.get('object');
	if (!object.isIdentifier()) return null;
	if (expectedObject && object.node.name !== expectedObject) return null;
	const cacheProperty = getPropertyName(cache);
	if (!cacheProperty) return null;

	if (!assign.isAssignmentExpression({ operator: '=' })) return null;
	if (!assign.get('left').matchesPattern(`${object.node.name}.${cacheProperty}`)) return null;

	return {
		object: object.node.name,
		property: cacheProperty,
		value: assign.get('right'),
	};
}

function findHashCandidates(path: NodePath) {
	const candidates = new Set<Binding>();
	path.traverse({
		FunctionDeclaration(func) {
			const funcId = func.node.id?.name;
			if (!funcId) return;

			for (const hashBinding of Object.values(func.scope.bindings)) {
				if (!hashBinding.constant) continue;

				const path = hashBinding.path.resolve();

				const cache = extractCache(path, funcId);

				const call = cache?.value;
				if (!call?.isCallExpression()) continue;

				const hashFunc = call.get('callee');
				if (!hashFunc.isIdentifier()) continue;
				if (!call.get('arguments').some(p => p.isNumericLiteral())) continue;

				const hashFuncBinding = pathAsBinding(hashFunc);
				if (!hashFuncBinding) continue;

				this.add(hashFuncBinding);
			}
		}
	}, candidates);

	return candidates;
}

function computeHashCall(ref: NodePath) {
	let call: NodePath | null = ref;
	if (ref.isIdentifier()) {
		call = getParentingCall(ref);
	}
	if (!call?.isCallExpression()) return null;

	let target;
	let seed;
	for (const arg of call.get('arguments')) {
		if (arg.isIdentifier() && target === undefined) {
			const resolved = arg.resolve();
			if (!resolved.isFunction()) continue;
			target = resolved;
		} else if (arg.isNumericLiteral() && seed === undefined) {
			seed = arg.node.value;
		}
	}
	if (!target || !seed) return null;

	let input = target.getSource();
	if (input.length === 0) return null;
	input = input.replace(DEFAULT_REPLACEMENT_REGEX, '');
	return cyrb(input, seed);
}

function extractHashCheck(call: NodePath<t.CallExpression>, equalityOnly = true) {
	const hash = computeHashCall(call);
	
	const decl = <NodePath<t.VariableDeclarator>>call.findParent(ancestor => ancestor.isVariableDeclarator());
	if (!decl) return null;

	const init = decl.get('init');
	if (!init.hasNode()) return null;
	if (init !== call) {
		const cache = extractCache(init);
		if (cache?.value !== call) return null;
	}

	const binding = pathAsBinding(decl);
	if (!binding?.constant) return null;
	if (binding.references !== 1) return null;

	const test = binding.referencePaths[0].parentPath;
	if (!test?.isBinaryExpression()) return null;
	if (equalityOnly && !['==', '==='].includes(test.node.operator)) return null;

	const ifStmt = test.parentPath;
	if (!ifStmt.isIfStatement() || test.key !== 'test') return null;

	binding.setValue(hash);

	const result = test.evaluateTruthy();
	if (result === undefined) return null;

	const consequent: NodePath = ifStmt.get('consequent');
	let alternate: NodePath<t.Node | null | undefined> = ifStmt.get('alternate');
	if (!alternate.hasNode()) {
		const after = ifStmt.getAllNextSiblings();
		if (after.length !== 1) return null;
		alternate = after[0];
		if (alternate.isStatement()) return null;
	}

	const executed = result ? consequent : alternate;
	const countermeasure = result ? alternate : consequent;

	if (!executed.hasNode()) return null;

	return {
		decl,
		ifStmt,
		executed,
		countermeasure,
	}
}

function inlineProxyFunction(func: NodePath<t.FunctionDeclaration>) {
	const returnStmt = func.get('body.body').at(-1);

	if (!returnStmt?.isReturnStatement()) return null;

	const call = returnStmt.get('argument');
	if (!call.isCallExpression()) return null;
	
	const target = call.get('callee');
	if (!target.isIdentifier()) return null;

	const args = call.get('arguments');
	if (args.length !== 1) return null;
	const spread = args[0];
	if (!spread.isSpreadElement()) return null;
	if (!spread.get('argument').isIdentifier({ name: 'arguments' })) return null;

	if (returnStmt.key === 0) {
		const binding = pathAsBinding(func);
		if (!binding?.constant) return null;

		for (const ref of binding.referencePaths) {
			ref.replaceWith(t.identifier(target.node.name));
		}

		func.remove();
	} else {
		if (func.node.params.length > 0) return null;

		const targetBinding = pathAsBinding(target);
		if (!targetBinding?.constant) return null;
		if (!targetBinding.referencePaths.every(ref => ref === target || isRemoved(ref))) return null;
		const targetFunc = targetBinding.path;
		if (!targetFunc.isFunctionDeclaration()) return null;

		for (const identifier in targetFunc.scope.bindings) {
			if (func.scope.hasOwnBinding(identifier)) {
				targetFunc.scope.rename(identifier, func.scope.generateUid(identifier));
			}
		}

		const newParams = targetFunc.node.params;
		const newBody = targetFunc.node.body.body;
		targetFunc.remove();
		func.pushContainer('params', newParams);
		returnStmt.replaceWithMultiple(newBody);
	}

	return target;
}

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		VariableDeclarator(decl) {
			const value = decl.get('init');

			if (!value.isLogicalExpression({ operator: '||' })) return;
			if (!value.get('left').matchesPattern('Math.imul')) return;
			const polyfillRef = value.get('right');

			const binding = pathAsBinding(decl);
			if (!isLooselyConstantBinding(binding)) return;
			for (const ref of binding.referencePaths) {
				ref.replaceWith(t.memberExpression(
					t.identifier('Math'),
					t.identifier('imul'),
					false,
					false,
				));
			}

			if (polyfillRef.isIdentifier()) {
				const polyfillBinding = pathAsBinding(polyfillRef);
				if (!polyfillBinding?.path.isFunctionDeclaration()) return;
				if (polyfillBinding.references !== 1) return;

				polyfillBinding.path.remove();
			}
		}
	});

	const hashCandidates = findHashCandidates(path);
	const hashFunctions = new Set<Binding>();
	for (const binding of hashCandidates) {
		const isCyrb = binding.referencePaths.some(ref => {
			const call = ref.parentPath;
			if (!call?.isCallExpression()) return false;

			const check = extractHashCheck(call);
			if (!check) return false;

			return true;
		});

		if (isCyrb) hashFunctions.add(binding);
	}

	const countermeasures = new Set<string>();
	for (const binding of hashFunctions) {
		for (const {call, ref} of getCallSites(binding)) {
			const check = extractHashCheck(call);
			if (!check) continue;

			const {
				decl,
				ifStmt,
				executed,
				countermeasure,
			} = check;

			decl.remove();
			countermeasures.add(
				(asSingleStatement(countermeasure) ?? countermeasure).toString()
			);
			countermeasure.remove();

			let newStmts = [executed.node];
			if (executed.isBlockStatement()) {
				newStmts = executed.node.body;
			}
			
			ifStmt.insertAfter(newStmts);
			ifStmt.remove();
			dereferencePathFromBinding(binding, ref);
			changed = true;

			const func = ref.getFunctionParent();
			if (func?.isFunctionDeclaration()) {
				inlineProxyFunction(func);
			}
		}

		if (countermeasures.size > 0) {
			path.addComment(
				'leading',
				'\nIntegrity countermeasures:\n' + [...countermeasures].join('\n') + '\n',
				false,
			);
		}

		if (binding.referencePaths.every(isRemoved)) {
			binding.path.remove();
		}
	}

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
}