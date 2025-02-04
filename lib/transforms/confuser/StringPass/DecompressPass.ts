import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import LZString from 'lz-string';
import { getPropertyName, isRemoved, pathAsBinding } from '../../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		CallExpression(call) {
			const func = call.get('callee');
			if (!func.isFunctionExpression()) return;

			const state: { isLZString: boolean } = { isLZString: false };
			func.traverse({
				ObjectProperty(prop) {
					if (getPropertyName(prop) !== 'decompressFromUTF16') return;

					this.isLZString = true;

					path.stop();
				}
			}, state);

			if (!state.isLZString) return;

			const assign = call.parentPath;
			let binding: Binding | null = null;
			if (assign.isVariableDeclarator()) {
				const idPath = assign.get('id');
				if (!idPath.isIdentifier()) return;

				binding = pathAsBinding(idPath);
			}

			if (!binding) return;

			let missed = false;
			for (const ref of binding.referencePaths) {
				const memberExpr = ref.parentPath;
				if (!memberExpr?.isMemberExpression() || ref.key !== 'object') continue;

				if (getPropertyName(memberExpr) !== 'decompressFromUTF16') continue;

				const call = memberExpr.parentPath;
				if (!call.isCallExpression()) continue;
				
				const args = call.get('arguments');
				if (args.length < 1) continue;

				let compressedStringBinding: Binding | null = null;
				let compressedStrings: NodePath = args[0];
				if (!compressedStrings.isStringLiteral()) {
					if (!compressedStrings.isIdentifier()) continue;
					compressedStringBinding = pathAsBinding(compressedStrings);
					if (!compressedStringBinding) continue;

					compressedStrings = compressedStrings.resolve();
					if (!compressedStrings.isStringLiteral()) continue;
				}

				const decompressedAssign = call.parentPath;
				if (!decompressedAssign.isVariableDeclarator()) continue;

				const decompressedBinding = pathAsBinding(decompressedAssign);
				if (!decompressedBinding) continue;

				for (const decompressedRef of decompressedBinding.referencePaths) {
					const memberExpr = decompressedRef.parentPath;
					if (!memberExpr?.isMemberExpression() || decompressedRef.key !== 'object') continue;
					if (getPropertyName(memberExpr) !== 'split') continue;
					
					const splitCall = memberExpr.parentPath;
					if (!splitCall.isCallExpression() || memberExpr.key !== 'callee') continue;
					
					const args = splitCall.get('arguments');
					if (args.length < 1) continue;

					const delimiterPath = args[0];
					if (!delimiterPath.isStringLiteral()) continue;

					const delimiter = delimiterPath.node.value;

					let strings: string[] | null = null;
					try {
						strings = LZString.decompressFromUTF16(compressedStrings.node.value).split(delimiter)
					} catch {
						continue;
					}

					if (!strings) continue;

					const arrayAssign = splitCall.parentPath;
					if (!arrayAssign.isVariableDeclarator()) continue;
					const arrayBinding = pathAsBinding(arrayAssign);
					if (!arrayBinding) continue;

					const stringFunction = arrayBinding.referencePaths.find(ref => 
						ref.parentPath?.isMemberExpression() && ref.key === 'object' && ref.parentPath.parentPath.isReturnStatement()
					)?.getFunctionParent();

					let stringFuncBinding: Binding | null = null;
					if (stringFunction?.isFunctionExpression()) {
						const funcAssign = stringFunction.parentPath;

						let funcId;
						if (funcAssign.isAssignmentExpression({ operator: '=' })) {
							funcId = funcAssign.get('left');
						} else if (funcAssign.isVariableDeclarator()) {
							funcId = funcAssign.get('id');
						}

						if (!funcId?.isIdentifier()) continue;

						stringFuncBinding = pathAsBinding(funcId);
					}

					if (!stringFuncBinding) continue;

					for (const ref of stringFuncBinding.referencePaths) {
						const stringCall = ref.parentPath;
						if (!stringCall?.isCallExpression()) {
							missed = true;
							continue;
						}

						const args = stringCall.get('arguments');
						if (args.length < 1) {
							missed = true;
							continue;
						}

						const indexEvaluation = args[0].evaluate();
						if (!indexEvaluation.confident) {
							missed = true;
							continue;
						}

						const index = indexEvaluation.value
						if (typeof index !== 'number') {
							missed = true;
							continue;
						}

						stringCall.replaceWith(t.stringLiteral(strings[index]));
					}

					compressedStringBinding?.path?.remove();
					decompressedAssign.remove();
					if (missed) {
						splitCall.replaceWith(t.valueToNode(strings));
					} else {
						if (stringFuncBinding.constantViolations.length <= 2) {
							if (stringFunction && stringFuncBinding.constantViolations.every(
								p => p.isAncestor(stringFunction) || (
									p.isAssignmentExpression({ operator: '=' }) && p.get('right').isIdentifier({ name: 'undefined' })
								)
							)) {
								stringFuncBinding.path.remove();
								for (const toRemove of stringFuncBinding.constantViolations) {
									if (isRemoved(toRemove)) continue;
									toRemove.remove();
								}
							}
						}

						if (stringFunction?.parentPath.isAssignmentExpression({ operator: '=' })) {
							stringFunction.parentPath.remove();
						} else {
							stringFunction?.remove();
						}
						arrayBinding.path.remove()

						const stringSetFunc = decompressedAssign.getFunctionParent();
						if (stringSetFunc?.isFunctionExpression()) {
							const call = stringSetFunc.parentPath;
							if (call.isCallExpression()) {
								if (stringSetFunc.node.body.body.length === 0) {
									call.remove();
								} else {
									const first = stringSetFunc.node.body.body[0];
									if (first.type === 'ReturnStatement' && !first.argument) {
										call.remove();
									}
								}
							}
						}
					}
				}

			}
			
			if (!missed) {
				binding.path.remove();
				for (const ref of binding.referencePaths) {
					const assign = ref.parentPath;
					if (!assign?.isAssignmentExpression({ operator: '=' }) || ref.key !== 'right') continue;
					if (!assign.get('left').matchesPattern('module.exports')) continue;
					
					let cjsCheck = assign.getStatementParent()?.parentPath;
					if (cjsCheck?.isBlockStatement()) {
						cjsCheck = cjsCheck.parentPath;
					}
					if (!cjsCheck?.isIfStatement()) continue;

					let exportParent = cjsCheck;
					while (exportParent.key === 'alternate') {
						const ancestor = exportParent.parentPath;
						if (!ancestor.isIfStatement()) break;

						exportParent = ancestor;
					}

					// TODO: narrow constraint and maybe ensure no other code is run during exporting

					exportParent.remove();

					break;
				}
				changed = true;
			}
		}
	})

	return changed;
}