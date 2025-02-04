import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import { dereferencePathFromBinding, getPropertyName, isRemoved, pathAsBinding } from '../../../utils.js';

function makeBase91Decoder(alphabet: string) {
	// Reference: https://github.com/aberaud/base91-python/blob/master/base91.py#L42
	return (encoded: string) => {
		let v = -1;
		let b = 0;
		let n = 0;
		const codepoints: number[] = [];

		for (const c of encoded) {
			const p = alphabet.indexOf(c);
			if (p === -1) continue;
			if (v < 0) {
				v = p;
			} else {
				v += p * 91;
				b |= v << n;
				n += (v & 8191) > 88 ? 13 : 14;
				do {
					codepoints.push(b & 0xff);
					b >>= 8;
					n -= 8;
				} while (n > 7);
				v = -1;
			}
		}

		if (v > -1) {
			codepoints.push((b | (v << n)) & 0xff);
		}

		return new TextDecoder().decode(new Uint8Array(codepoints));
	}
}

interface DecoderInfo {
	decoder: (encoded: string) => string,
	toRemove: NodePath[],
	codepointDecoder: Binding | null,
};

function findDecoders(path: NodePath) {
	const decoderCandidates: Set<NodePath> = new Set()
	path.traverse({
		AssignmentExpression(expr) {
			if (expr.node.operator !== '+=') return;
			if (!expr.get('left').isIdentifier()) return;

			const value = expr.get('right');
			if (!value.isConditionalExpression()) return;
			const test = value.get('test');
			if (!test.isBinaryExpression({ operator: '>' })) return;
			if (!test.get('right').isNumericLiteral({ value: 0x58 })) return;

			const masked = test.get('left');
			if (!masked.isBinaryExpression({ operator: '&' })) return;
			if (!masked.get('right').isNumericLiteral({ value: 0x1fff })) return;

			if (!value.get('consequent').isNumericLiteral({ value: 0xd })) return;
			if (!value.get('alternate').isNumericLiteral({ value: 0xe })) return;

			const func = expr.getFunctionParent();
			if (!func) return;
			this.decoderCandidates.add(func);
		}
	}, { decoderCandidates });

	const decoders = new Map<Binding, DecoderInfo>();
	for (const candidate of decoderCandidates) {
		const state: {
			alphabet: string | null;
			codepointDecoder: Binding | null;
		} = {
			alphabet: null,
			codepointDecoder: null,
		};
		candidate.traverse({
			VariableDeclarator(decl) {
				const init = decl.get('init');

				if (!init.isStringLiteral()) return;
				if (init.node.value.length < 91) return;

				const binding = pathAsBinding(decl);
				if (!binding) return;

				for (const ref of binding.referencePaths) {
					const memberExpr = ref.parentPath;
					if (!memberExpr?.isMemberExpression() || ref.key !== 'object') continue;
					if (getPropertyName(memberExpr) !== 'indexOf') continue;

					const call = memberExpr.parentPath;
					if (!call.isCallExpression() || memberExpr.key !== 'callee') continue;

					if (this.alphabet) return;
					this.alphabet = init.node.value.slice(0, 91);
				}
			},
			ReturnStatement(ret) {
				const argument = ret.get('argument');
				if (!argument.isCallExpression()) return;

				const callee = argument.get('callee');
				if (!callee.isIdentifier()) return;

				const binding = pathAsBinding(callee);
				if (!binding) return;

				if (this.codepointDecoder) return;

				this.codepointDecoder = binding;
			},
		}, state);

		if (!state.alphabet) continue;

		let binding: Binding | null | undefined = null;
		const toRemove: NodePath[] = [];
		if (candidate.isFunctionDeclaration()) {
			binding = pathAsBinding(candidate);
			toRemove.push(candidate);
		} else if (candidate.isFunctionExpression()) {
			const assign = candidate.parentPath;
			if (!assign.isAssignmentExpression({ operator: '=' }) || candidate.key !== 'right') continue;
			const id = assign.get('left');
			if (!id.isIdentifier()) continue;
			binding = pathAsBinding(id);

			const stmt = assign.parentPath;
			if (stmt.isExpressionStatement()) {
				let ifStmt = stmt.parentPath;
				if (ifStmt.isBlockStatement()) ifStmt = ifStmt.parentPath;
				
				if (ifStmt.isIfStatement() && !ifStmt.has('alternate')) {
					const test = ifStmt.get('test');
					if (test.isUnaryExpression({ operator: '!', prefix: true }) && test.get('argument').isIdentifier({ name: id.node.name })) {
						toRemove.push(ifStmt);
						if (binding?.kind === 'param') {
							toRemove.push(binding.path);
						}
					}
				}
			}
		}

		if (!binding) continue;

		decoders.set(binding, {
			decoder: makeBase91Decoder(state.alphabet),
			toRemove,
			codepointDecoder: state.codepointDecoder,
		});
	}

	return decoders;
}

interface StringFunctionInfo {
	array: Binding,
	toRemove: NodePath[],
};

export default (path: NodePath): boolean => {
	let changed = false;

	const decoders = findDecoders(path);
	const stringCaches = new Set<Binding>();

	for (const [binding, { decoder, toRemove }] of decoders.entries()) {
		const stringFunctions = new Map<Binding, StringFunctionInfo>();
		const stringArrays = new Map<Binding, string[]>();
		
		let missedDecoderRef = false;
		for (const ref of [...binding.referencePaths]) {
			if (isRemoved(ref)) continue;

			const {parentPath} = ref;
			if (!parentPath?.isCallExpression() || ref.key !== 'callee') {
				if (parentPath && toRemove.some(p => p.isAncestor(parentPath))) {
					continue;
				}

				missedDecoderRef = true;
				continue;
			}
		
			const stringFunction = parentPath.getFunctionParent();
			if (!stringFunction) {
				missedDecoderRef = true;
				continue;
			}

			let funcBinding: Binding | null | undefined = null;
			const toRemoveForStringFunc: NodePath[] = [];
			if (stringFunction.isFunctionDeclaration()) {
				funcBinding = pathAsBinding(stringFunction);
				toRemoveForStringFunc.push(stringFunction);
			} else if (stringFunction.isFunctionExpression()) {
				const assign = stringFunction.parentPath;
				if (!assign.isAssignmentExpression({ operator: '=' }) || stringFunction.key !== 'right') continue;
				const id = assign.get('left');
				if (!id.isIdentifier()) continue;
				funcBinding = pathAsBinding(id);

				const stmt = assign.parentPath;
				if (stmt.isExpressionStatement()) {
					let ifStmt = stmt.parentPath;
					if (ifStmt.isBlockStatement()) ifStmt = ifStmt.parentPath;

					if (ifStmt.isIfStatement() && !ifStmt.has('alternate')) {
						const test = ifStmt.get('test');
						if (test.isUnaryExpression({ operator: '!', prefix: true }) && test.get('argument').isIdentifier({ name: id.node.name })) {
							toRemoveForStringFunc.push(ifStmt);
							if (funcBinding?.kind === 'param') {
								toRemoveForStringFunc.push(funcBinding.path);
							}
						}
					}
				}
			}

			if (!funcBinding) {
				missedDecoderRef = true;
				continue;
			}

			const args = parentPath.get('arguments');
			if (args.length === 0) {
				missedDecoderRef = true;
				continue;
			}

			const encodedArg = args[0];
			if (!encodedArg.isMemberExpression()) {
				missedDecoderRef = true;
				continue;
			}

			const arrayId = encodedArg.get('object');
			if (!arrayId.isIdentifier()) {
				missedDecoderRef = true;
				continue;
			}

			const arrayBinding = pathAsBinding(arrayId);

			if (!arrayBinding) {
				missedDecoderRef = true;
				continue;
			}

			const arrayPath = arrayId.resolve();
			if (!arrayPath.isArrayExpression()) {
				// TODO
				missedDecoderRef = true;
				continue;
			}

			if (!stringArrays.has(arrayBinding)) {
				try {
					const values = arrayPath.get('elements').map(e => {
						if (!e.isStringLiteral()) throw new Error('unexpected non-literal');

						return e.node.value;
					});

					stringArrays.set(arrayBinding, values);
				} catch {
					missedDecoderRef = true;
					continue;
				}
			}

			if (!stringFunctions.has(funcBinding)) {
				stringFunctions.set(funcBinding, {
					array: arrayBinding,
					toRemove: toRemoveForStringFunc,
				});
			/*
			} else {
				throw new Error('unexpected');
			*/
			}

			const state: { cacheBinding: Binding | null } = { cacheBinding: null };
			stringFunction.traverse({
				ReturnStatement(ret) {
					const cachedValue = ret.get('argument');
					if (!cachedValue.isMemberExpression()) return;

					const cache = cachedValue.get('object');
					if (!cache.isIdentifier()) return;
					const cacheBinding = pathAsBinding(cache);
					if (!cacheBinding) return;

					this.cacheBinding = cacheBinding;
					path.stop();
				}
			}, state);

			if (state.cacheBinding) {
				stringCaches.add(state.cacheBinding);
			}
		}

		for (const [stringFunction, {array, toRemove}] of stringFunctions.entries()) {
			for (const ref of [...stringFunction.referencePaths]) {
				if (isRemoved(ref)) {
					dereferencePathFromBinding(stringFunction, ref);
					continue;
				}

				const {parentPath} = ref;
				if (!parentPath?.isCallExpression() || ref.key !== 'callee') {
					if (parentPath && toRemove.some(p => p.isAncestor(parentPath))) {
						continue;
					}

					continue;
				}

				const args = parentPath.get('arguments');
				if (args.length === 0) {
					continue;
				}

				const index = args[0];
				if (!index.isNumericLiteral()) {
					continue;
				}

				const values = stringArrays.get(array);
				if (!values) {
					continue;
				}

				parentPath.replaceWith(
					t.stringLiteral(
						decoder(values[index.node.value])
					)
				);

				dereferencePathFromBinding(stringFunction, ref);
				changed = true;
			}
			
			const missedStringFuncRef = stringFunction.references > 0 && (
				!stringFunction.referencePaths.every(
					ref => toRemove.some(p => p.isAncestor(ref)),
				)
			);
			if (!missedStringFuncRef) {
				for (const node of toRemove) {
					node.remove();
				}
			}
			missedDecoderRef = missedDecoderRef || missedStringFuncRef;
		}

		if (!missedDecoderRef) {
			for (const node of toRemove) {
				node.remove();
			}
		}

		for (const binding of stringArrays.keys()) {
			if (!binding.referencePaths.every(isRemoved)) continue;
			binding.path.remove();
		}
	}

	const codepointDecoders = new Set(
		[...decoders.values()].map(
			({ codepointDecoder }) => codepointDecoder
		).filter((binding): binding is Binding => binding !== null)
	);
	const decoderPolyfills = new Set<Binding>();
	for (const binding of codepointDecoders) {
		if (!binding.referencePaths.every(isRemoved)) continue;

		const state: {
			decoderPolyfill: Binding | null;
		} = {
			decoderPolyfill: null
		}
		binding.path.traverse({
			ReturnStatement(ret) {
				const argument = ret.get('argument');
				if (!argument.isCallExpression()) return;

				const callee = argument.get('callee');
				if (!callee.isIdentifier()) return;

				const binding = pathAsBinding(callee);
				if (!binding) return;

				if (!this.decoderPolyfill) {
					this.decoderPolyfill = binding;
				}
				ret.skip();
			}
		}, state);

		if (state.decoderPolyfill) {
			decoderPolyfills.add(state.decoderPolyfill);
		}

		binding.path.remove();
	}

	for (const binding of decoderPolyfills) {
		if (!binding.referencePaths.every(isRemoved)) continue;
		binding.path.remove();
	}

	for (const binding of stringCaches) {
		if (!binding.referencePaths.every(isRemoved)) continue;
		binding.path.remove();
	}

	return changed;
};