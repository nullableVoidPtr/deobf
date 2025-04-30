import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import LZString from 'lz-string';
import { dereferencePathFromBinding, getParentingCall, getPropertyName, isRemoved, pathAsBinding } from '../../../utils.js';

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

			const decompressedStrings = new Map<Binding, string>();
			for (const ref of [...binding.referencePaths]) {
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

				let decompressedString;
				try {
					decompressedString = LZString.decompressFromUTF16(compressedStrings.node.value);
				} catch {
					continue;
				}

				if (!decompressedString) continue;

				call.replaceWith(t.stringLiteral(decompressedString));
				dereferencePathFromBinding(binding, ref);

				if (compressedStringBinding) {
					if (compressedStringBinding.constantViolations.length <= 1) {
						if (compressedStringBinding.referencePaths.every(ref => isRemoved(ref) || call.isAncestor(ref))) {
							compressedStringBinding.path.remove();
							for (const assign of compressedStringBinding.constantViolations) {
								if (isRemoved(assign)) continue;
								assign.remove();
							}
						}
					}
				}

				const decompressedAssign = call.parentPath;
				let decompressedBinding;
				if (decompressedAssign.isVariableDeclarator()) {
					decompressedBinding = pathAsBinding(decompressedAssign);
				} else if (decompressedAssign.isAssignmentExpression({ operator: '=' })) {
					const assignee = decompressedAssign.get('left');
					if (!assignee.isIdentifier()) continue;

					decompressedBinding = pathAsBinding(assignee);
					if (decompressedBinding?.constantViolations.length !== 1) continue;
				}

				if (!decompressedBinding) continue;

				decompressedStrings.set(decompressedBinding, decompressedString);
			}
		
			const stringArrays = new Map<Binding, string[]>();
			for (const [decompressedBinding, decompressedString] of decompressedStrings) {
				for (const ref of [...decompressedBinding.referencePaths]) {
					const memberExpr = ref.parentPath;
					if (!memberExpr?.isMemberExpression() || ref.key !== 'object') continue;
					if (getPropertyName(memberExpr) !== 'split') continue;
					
					const splitCall = getParentingCall(memberExpr);
					if (!splitCall) continue;
					
					const args = splitCall.get('arguments');
					if (args.length < 1) continue;

					const delimiterPath = args[0];
					if (!delimiterPath.isStringLiteral()) continue;

					const strings = decompressedString.split(delimiterPath.node.value);
					splitCall.replaceWith(t.arrayExpression(
						strings.map(t.stringLiteral),
					));

					dereferencePathFromBinding(decompressedBinding, ref);

					const arrayAssign = splitCall.parentPath;
					let arrayBinding
					if (arrayAssign.isVariableDeclarator()) {
						arrayBinding = pathAsBinding(arrayAssign);
					} else if (arrayAssign.isAssignmentExpression({ operator: '=' })) {
						const assignee = arrayAssign.get('left');
						if (!assignee.isIdentifier()) continue;

						arrayBinding = pathAsBinding(assignee);
						if (arrayBinding?.constantViolations.length !== 1) continue;
					}
					if (!arrayBinding) continue;

					stringArrays.set(arrayBinding, strings);
				}

				if (decompressedBinding.referencePaths.every(isRemoved)) {
					decompressedBinding.path.remove();
					for (const assign of decompressedBinding.constantViolations) {
						if (isRemoved(assign)) continue;
						assign.remove();
					}
				}
			}

			for (const [arrayBinding, strings] of stringArrays) {
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
				} else {
					continue;
				}

				if (!stringFuncBinding) continue;

				for (const ref of [...stringFuncBinding.referencePaths]) {
					const stringCall = ref.parentPath;
					if (!stringCall?.isCallExpression()) continue;

					const args = stringCall.get('arguments');
					if (args.length < 1) continue;

					const indexEvaluation = args[0].evaluate();
					if (!indexEvaluation.confident) continue;

					const index = indexEvaluation.value
					if (typeof index !== 'number') continue;

					stringCall.replaceWith(t.stringLiteral(strings[index]));
					dereferencePathFromBinding(stringFuncBinding, ref);
				}

				if (stringFuncBinding.referencePaths.every(isRemoved)) {
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
					arrayBinding.path.remove();
					for (const assign of arrayBinding.constantViolations) {
						if (isRemoved(assign)) continue;
						assign.remove();
					}

					const stringSetFunc = stringFunction.getFunctionParent();
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

			if (binding.referencePaths.every(isRemoved)) {
				binding.path.remove();
				changed = true;
			}
		}
	})

	return changed;
}