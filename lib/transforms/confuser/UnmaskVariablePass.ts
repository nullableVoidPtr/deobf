import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import UnhoistPass from './UnhoistPass.js';
import { getPropertyName, isRemoved, pathAsBinding } from '../../utils.js';
import { crawlProperties } from '../../ObjectBinding.js';

function getFunctionLength(path: NodePath, argsId: string | undefined) {
	if (!path.isExpressionStatement()) return null;

	const funcLengthAssign = path.get('expression');
	if (!funcLengthAssign.isAssignmentExpression({ operator: '=' })) return null;

	const lengthMember = funcLengthAssign.get('left');
	if (!lengthMember.isMemberExpression()) return null;
	if (!lengthMember.get('object').isIdentifier(argsId ? { name: argsId } : undefined)) return null;
	if (getPropertyName(lengthMember) !== 'length') return null;

	const lengthPath = funcLengthAssign.get('right');
	if (!lengthPath.isNumericLiteral()) return null;

	return lengthPath.node.value;
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		FunctionDeclaration(maskFunc) {
			const body = maskFunc.get('body').get('body');
			if (body.length !== 2) return;

			const params = maskFunc.get('params');
			if (params.length !== 2) return;
			const [funcArg, lengthArg] = params;
			if (!funcArg.isIdentifier()) return;

			let defaultLength: number | null = null;
			if (lengthArg.isAssignmentPattern() && lengthArg.get('left').isIdentifier()) {
				const right = lengthArg.get('right');
				if (right.isNumericLiteral()) {
					defaultLength = right.node.value;
				}
			} else if (!lengthArg.isIdentifier()) {
				return;
			}

			const [defineStmt, ret] = body;
			if (!ret.isReturnStatement()) return;
			if (!ret.get('argument').isIdentifier({ name: funcArg.node.name })) return;

			if (!defineStmt.isExpressionStatement()) return;
			const call = defineStmt.get('expression');
			if (!call.isCallExpression()) return;
			if (!call.get('callee').matchesPattern('Object.defineProperty')) return;

			const definePropertyArgs = call.get('arguments');
			if (definePropertyArgs.length !== 3) return;
			if (!definePropertyArgs[0].isIdentifier({ name: funcArg.node.name })) return;
			if (!definePropertyArgs[1].isStringLiteral({ value: 'length' })) return;
			
			const propertySpec = definePropertyArgs[2];
			if (!propertySpec.isObjectExpression()) return;

			let hasValue = false;
			let hasConfigurable = false;
			for (const specProp of propertySpec.get('properties')) {
				if (!specProp.isObjectProperty()) return;

				const key = getPropertyName(specProp);
				if (key === 'value') {
					const value = specProp.get('value');
					if (!value.isIdentifier()) return;
					hasValue = true;
				} else if (key === 'configurable') {
					const value = specProp.get('value');
					if (!value.isBooleanLiteral({ value: false })) return;
					hasConfigurable = true;
				}
			}

			if (!hasValue || !hasConfigurable) return;

			const binding = pathAsBinding(maskFunc);
			if (!binding) return;

			let missed = false;
			for (const ref of binding.referencePaths) {
				if (isRemoved(ref)) continue;

				const call = ref.parentPath;
				if (!call?.isCallExpression() || ref.key !== 'callee') {
					missed = true;
					continue;
				}

				const args = call.get('arguments');
				if (args.length < 1) {
					changed = true;
					continue;
				}

				const [func, lengthArg] = args;

				let length = defaultLength;
				if (lengthArg?.isNumericLiteral()) {
					length = lengthArg.node.value;
				}

				if (length !== null && func.isIdentifier()) {
					const binding = pathAsBinding(func);
					if (binding) {
						binding.path.setData('fnLength', defaultLength);
					}
				}

				if (call.parentPath.isExpressionStatement()) {
					call.parentPath.remove();
					changed = true;
					continue;
				}

				call.replaceWith(func);
				changed = true;
			}

			if (!missed) {
				maskFunc.remove();
				changed = true;
			}
		}
	})

	path.traverse({
		Function(func) {
			const params = func.get('params');
			if (params.length !== 1) return;
			const restParam = params[0];
			if (!restParam.isRestElement()) return;
			const argsId = restParam.get('argument');
			if (!argsId.isIdentifier()) return;

			const blockStmt = func.get('body');
			if (!blockStmt.isBlockStatement()) return;

			const body = blockStmt.get('body');

			const firstStatement = body[0];

			let funcLengthAssignStmt: NodePath | null = firstStatement;
			while (funcLengthAssignStmt.hasNode()) {
				if (funcLengthAssignStmt.isExpressionStatement()) {
					if (funcLengthAssignStmt.get('expression').isAssignmentExpression({ operator: '=' })) {
						break;
					}
				}

				funcLengthAssignStmt = funcLengthAssignStmt.getNextSibling();
			}


			let functionLength = getFunctionLength(funcLengthAssignStmt, argsId.node.name)
			if (functionLength === null) {
				funcLengthAssignStmt = null;
				functionLength = func.getData('fnLength', null);
			}

			func.scope.crawl();

			const argsBinding = func.scope.getBinding(argsId.node.name);
			if (!argsBinding) return;

			const objBinding = crawlProperties(argsBinding, true);
			if (objBinding.objectReferences.size > 0) return;
			if (objBinding.unresolvedReferences.size > 0) return;

			const lengthProperty = objBinding.properties.get('length');
			if (lengthProperty?.referenced) return;

			if (functionLength === null) {
				funcLengthAssignStmt = null;
				functionLength = 0;

				// TODO: make this edge case more robust

				if (!argsBinding.referenced && argsBinding.constant) {
					func.node.params = [];
					return;
				}
			} else {
				const lengthAssigns = lengthProperty?.constantViolations ?? [];
				for (const assign of lengthAssigns) {
					if (funcLengthAssignStmt?.isAncestor(assign)) continue;
					return;
				}
			}

			const newParams: t.Identifier[] = [];
			for (let i = 0; i < functionLength; i++) {
				newParams.push(func.scope.generateUidIdentifier('args_' + i + '_'));
			}

			const localVars = new Map<string | number, t.Identifier>();
			let lastDecl: NodePath<t.VariableDeclarator> | null = null;

			for (const [property, binding] of objBinding.properties.entries()) {
				if (property === 'length') continue;

				const allReferences = [
					...binding.constantViolationMap.values(),
					...binding.referencePaths
				];
				if (allReferences.length === 0) continue;

				let newId;
				if (typeof property === 'number' && property < functionLength) {
					newId = newParams[property];
				} else {
					let name = 'var_' + property;
					if (typeof property === 'number') {
						name += '_';
					}
					localVars.set(property, newId = func.scope.generateUidIdentifier(name));
					const decl = t.variableDeclarator(t.identifier(newId.name));
					if (!lastDecl) {
						const [decn] = firstStatement.insertBefore(
							t.variableDeclaration('var', [decl])
						);
						lastDecl = decn.get('declarations')[0];
					} else {
						[lastDecl] = lastDecl.insertAfter(decl);
					}
				}

				for (const ref of allReferences) {
					ref.replaceWith(t.identifier(newId.name));
				}
			}

			/*
			for (const ref of argsBinding.referencePaths) {
				const parentPath = ref.parentPath;

				if (!parentPath?.isMemberExpression() || ref.key !== 'object') {
					throw new Error('unexpected non-MemberExpression');
				}

				if (funcLengthAssignStmt?.isAncestor(parentPath)) continue;

				const property = parentPath.get('property');
				if (property.isNumericLiteral()) {
					const index = property.node.value;
					if (index >= functionLength) {
						const name = 'var_' + index + '_';

						let newId = localVars.get(name);
						if (!newId) {
							localVars.set(name, newId = func.scope.generateUidIdentifier(name));
							const decl = t.variableDeclarator(t.identifier(newId.name));
							if (!lastDecl) {
								const [decn] = firstStatement.insertBefore(
									t.variableDeclaration('var', [decl])
								);
								lastDecl = decn.get('declarations')[0];
							} else {
								[lastDecl] = lastDecl.insertAfter(decl);
							}
						}

						parentPath.replaceWith(t.identifier(newId.name));
						changed = true;
						continue;
					}

					parentPath.replaceWith(t.identifier(newParams[index].name));
					changed = true;
				} else if (property.isUnaryExpression({ operator: '-', prefix: true })) {
					const argument = property.get('argument');
					if (!argument.isNumericLiteral()) {
						throw new Error();
					}
					const index = -argument.node.value;
					if (index === 0) {
						parentPath.replaceWith(t.identifier(newParams[index].name));
						changed = true;
					} else {
						const name = 'var_minus_' + (+index) + '_';

						let newId = localVars.get(name);
						if (!newId) {
							localVars.set(name, newId = func.scope.generateUidIdentifier(name));
							const decl = t.variableDeclarator(t.identifier(newId.name));
							if (!lastDecl) {
								const [decn] = firstStatement.insertBefore(
									t.variableDeclaration('var', [decl])
								);
								lastDecl = decn.get('declarations')[0];
							} else {
								[lastDecl] = lastDecl.insertAfter(decl);
							}
						}

						parentPath.replaceWith(t.identifier(newId.name));
						changed = true;
					}
				} else if (property.isIdentifier() && !parentPath.node.computed) {
					const name = property.node.name;

					let newId = localVars.get(name);
					if (!newId) {
						localVars.set(name, newId = func.scope.generateUidIdentifier('var_' + name));
						const decl = t.variableDeclarator(t.identifier(newId.name));
						if (!lastDecl) {
							const [decn] = firstStatement.insertBefore(
								t.variableDeclaration('var', [decl])
							);
							lastDecl = decn.get('declarations')[0];
						} else {
							[lastDecl] = lastDecl.insertAfter(decl);
						}
					}

					parentPath.replaceWith(t.identifier(newId.name));
					changed = true;
				} else {
					throw new Error();
				}
			}
			*/

			func.node.params = newParams;
			funcLengthAssignStmt?.remove();

			func.scope.crawl();
			UnhoistPass(func);

			changed = true;
		}
	});

	path.scope.crawl();

	return changed;
}