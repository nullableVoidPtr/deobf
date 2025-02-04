import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import { asSingleStatement, pathAsBinding } from '../../utils.js';
import { filterBody } from './utils.js';

function fixDispatchedFunction(func: NodePath<t.FunctionExpression>, newFuncName: string, argsArrayName: string) {
	if (func.node.params.length !== 0) return null;

	const body = func.get('body').get('body');
	let argsDecn: NodePath | null = null
	let argsPattern: NodePath | null = null;
	for (const stmt of body) {
		if (!stmt?.isVariableDeclaration()) return null;
		if (stmt.node.declarations.length !== 1) continue;

		const argsDecl = stmt.get('declarations')[0];
		if (!argsDecl.get('init').isIdentifier({ name: argsArrayName })) continue;

		argsPattern = argsDecl.get('id');
		argsDecn = stmt;
		break;
	}
	
	if (!argsPattern) return null;

	if (argsPattern.isArrayPattern()) {
		const newParams = [];
		for (const param of argsPattern.get('elements')) {
			if (!param.hasNode()) return null;
			if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) return null;
			newParams.push(param.node);
		}

		return t.functionDeclaration(
			t.identifier(newFuncName),
			newParams,
			t.blockStatement(
				body.filter(stmt => stmt !== argsDecn).map(p => p.node),
			),
			func.node.generator,
			func.node.async,
		);
	}

	return null;
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		ObjectExpression(funcsObj) {
			const funcs = new Map<string, NodePath<t.FunctionExpression>>();
			for (const property of funcsObj.get('properties')) {
				if (!property.isObjectProperty()) return;
				const func = property.get('value');
				if (!func.isFunctionExpression()) return;

				const keyPath = property.get('key');
				let key;
				if (keyPath.isIdentifier()) {
					key = keyPath.node.name;
				} else if (keyPath.isStringLiteral()) {
					key = keyPath.node.value.toString();
				} else {
					return;
				}

				funcs.set(key, func);
			}

			const funcsAssign = funcsObj.parentPath;
			let funcsId
			if (funcsAssign.isVariableDeclarator() && funcsObj.key === 'init') {
				funcsId = funcsAssign.get('id');
			} else if (funcsAssign.isAssignmentExpression({ operator: '=' }) && funcsObj.key === 'right') {
				funcsId = funcsAssign.get('left');
			} else {
				return;
			}

			if (!funcsId.isIdentifier()) return;

			const dispatcherFunc = funcsAssign.getFunctionParent();
			if (!dispatcherFunc?.isFunctionDeclaration()) return;
			const dispatcherBinding = pathAsBinding(dispatcherFunc);
			if (!dispatcherBinding) return;

			const params = dispatcherFunc.get('params');
			if (params.length < 4) return;

			const [funcNameParam, flagParam, objReturnParam, funcsLengthPattern] = params;
			if (!funcNameParam.isIdentifier()) return;
			if (!flagParam.isIdentifier()) return;
			if (!objReturnParam.isIdentifier()) return;
			if (!funcsLengthPattern.isAssignmentPattern()) return;

			const funcsLengthParam = funcsLengthPattern.get('left');
			if (!funcsLengthParam.isIdentifier()) return;
			const funcsLengthObj = funcsLengthPattern.get('right');
			if (!funcsLengthObj.isObjectExpression()) return;

			const funcLengths = new Map<string, number>();
			for (const property of funcsLengthObj.get('properties')) {
				if (!property.isObjectProperty()) return;
				const length = property.get('value');
				if (!length.isNumericLiteral()) return;

				const keyPath = property.get('key');
				let key;
				if (keyPath.isIdentifier()) {
					key = keyPath.node.name;
				} else if (keyPath.isStringLiteral()) {
					key = keyPath.node.value.toString();
				} else {
					return;
				}

				funcLengths.set(key, length.node.value);
			}

			if (![...funcLengths.keys()].every(name => funcs.has(name))) return;

			const flagBinding = dispatcherFunc.scope.getBinding(flagParam.node.name);
			if (!flagBinding) return;

			let argArrayBinding: Binding | null = null;
			let funcCacheBinding: Binding | null = null;
			let clearArgArrayFlag, retFuncFlag;
			for (const ref of flagBinding.referencePaths) {
				const flagCompare = ref.parentPath;
				if (!flagCompare?.isBinaryExpression({ operator: '===' })) return;

				const flagValue = ref.getOpposite();
				if (!flagValue?.isStringLiteral()) return;

				const flagIfStmt = flagCompare.parentPath;
				if (!flagIfStmt.isIfStatement()) return;

				const block = flagIfStmt.get('consequent');
				if (!block.isBlockStatement()) return;
				const body = filterBody(block.get('body'));

				if (body.length === 1 && clearArgArrayFlag == undefined) {
					const stmt = body[0];
					if (!stmt.isExpressionStatement()) return;
					const assign = stmt.get('expression');
					if (!assign.isAssignmentExpression({ operator: '=' })) return;
					
					const argArrayId = assign.get('left');
					if (!argArrayId.isIdentifier()) return;

					const array = assign.get('right');
					if (!array.isArrayExpression() || array.node.elements.length > 0)  return;

					const binding = pathAsBinding(argArrayId);
					if (!binding) return;

					argArrayBinding = binding;
					clearArgArrayFlag = flagValue.node.value;
				} else if (body.length === 2 && retFuncFlag == undefined) {
					if (!body[0].isFunctionDeclaration()) return;
					const stmt = body[1];
					if (!stmt.isExpressionStatement()) return;
					const assign = stmt.get('expression');
					if (!assign.isAssignmentExpression({ operator: '=' })) return;

					const cacheUpsert = assign.get('right');
					if (!cacheUpsert.isLogicalExpression({ operator: '||' })) return;

					const cacheAccess = cacheUpsert.get('left');
					if (!cacheAccess.isMemberExpression({ computed: true }) || !cacheAccess.get('property').isIdentifier({ name: funcNameParam.node.name })) return;

					const cache = cacheAccess.get('object');
					if (!cache.isIdentifier()) return;

					const binding = pathAsBinding(cache);
					if (!binding) return;

					funcCacheBinding = binding;
					retFuncFlag = flagValue.node.value;
				} else {
					return;
				}
			}

			if (!argArrayBinding) return;

			const objReturnBinding = dispatcherFunc.scope.getBinding(objReturnParam.node.name);
			if (objReturnBinding?.referencePaths.length !== 1) return;

			const objReturnRef = objReturnBinding.referencePaths[0];
			const objReturnCompare = objReturnRef.parentPath;
			if (!objReturnCompare?.isBinaryExpression({ operator: '===' })) return;

			const objReturnValue = objReturnRef.getOpposite();
			if (!objReturnValue?.isStringLiteral()) return;

			const objReturnIfStmt = objReturnCompare.parentPath;
			if (!objReturnIfStmt.isIfStatement()) return;
			const objReturn = asSingleStatement(objReturnIfStmt.get('consequent'));
			if (!objReturn?.isReturnStatement()) return;
			const objReturnObj = objReturn.get('argument');
			if (!objReturnObj.isObjectExpression() || objReturnObj.node.properties.length !== 1) return;
			const objReturnProp = objReturnObj.get('properties')[0];
			if (!objReturnProp.isObjectProperty() || objReturnProp.node.computed) return;
			const objReturnKeyPath = objReturnProp.get('key');
			if (!objReturnKeyPath.isIdentifier()) return;
			const objReturnKey = objReturnKeyPath.node.name;

			let alternate: NodePath<t.Node | null | undefined> = objReturnIfStmt.get('alternate');
			if (!alternate.hasNode()) {
				alternate = objReturnIfStmt.getNextSibling();
			} else if (alternate.isBlockStatement()) {
				alternate = alternate.get('body')[0];
			}
			if (!alternate.isReturnStatement()) return;

			let missed = false;
			const outlinedFuncs = new Map<string, string | null>();
			for (const ref of dispatcherBinding.referencePaths) {
				const call = ref.parentPath;
				if (!(call?.isCallExpression() || call?.isNewExpression()) || ref.key !== 'callee') {
					missed = true;
					continue;
				}

				const dispatcherArgs = (<NodePath<t.CallExpression | t.NewExpression>>call).get('arguments');
				if (dispatcherArgs.length < 1) {
					missed = true;
					continue;
				}
				
				const nameArg = dispatcherArgs[0];
				if (!nameArg.isStringLiteral()) {
					missed = true;
					continue;
				}

				const funcName = nameArg.node.value
				let outlinedFuncName = outlinedFuncs.get(funcName);
				if (outlinedFuncName === null) {
					missed = true;
					continue;
				} else if (outlinedFuncName === undefined) {
					const func = funcs.get(nameArg.node.value);
					if (!func) {
						missed = true;
						continue;
					}

					const generatedName = dispatcherBinding.scope.generateUid(funcName);
					const outlined = fixDispatchedFunction(func, generatedName, argArrayBinding.identifier.name);
					if (!outlined) {
						outlinedFuncs.set(funcName, null);
						missed = true;
						continue;
					}
					
					dispatcherFunc.insertAfter([outlined]);
					outlinedFuncs.set(funcName, outlinedFuncName = generatedName);
					changed = true;
				}

				const flagArg = dispatcherArgs.at(1);
				const clearArg = flagArg?.isStringLiteral({ value: clearArgArrayFlag });
				const retFunc = flagArg?.isStringLiteral({ value: retFuncFlag });

				const objReturn = dispatcherArgs.at(2)?.isStringLiteral({ value: objReturnValue.node.value });

				let ancestor: NodePath = call;
				let wrapped = false;
				if (objReturn) {
					wrapped = true;
					const memberExpr = call.parentPath;
					if (memberExpr.isMemberExpression({ computed: false }) && memberExpr.get('property').isIdentifier({ name: objReturnKey })) {
						ancestor = memberExpr;
						wrapped = false;
					}
				}

				let result: t.Expression;
				if (retFunc) {
					result = t.identifier(outlinedFuncName);
				} else {
					const args: (t.Expression | t.SpreadElement)[] = [];
					if (!clearArg) {
						const sequence = ancestor.parentPath;
						if (!sequence?.isSequenceExpression()) {
							missed = true;
							continue;
						}

						const argAssign = ancestor.getPrevSibling();
						ancestor = sequence;

						if (!argAssign.isAssignmentExpression({ operator: '=' }) || !argAssign.get('left').isIdentifier({ name: argArrayBinding.identifier.name })) {
							missed = true;
							continue;
						}

						const array = argAssign.get('right');
						if (!array.isArrayExpression()) {
							missed = true;
							continue;
						}

						const elements = array.get('elements');
						if (!elements.every(e => e.hasNode())) {
							missed = true;
							continue;
						}

						args.push(...<(t.Expression | t.SpreadElement)[]>elements.map(e => e.node));
					}

					result = t.callExpression(
						t.identifier(outlinedFuncName),
						args,
					);
				}

				if (wrapped) {
					result = t.objectExpression([
						t.objectProperty(t.identifier(objReturnKey), result),
					]);
				}

				ancestor.replaceWith(result);
				changed = true;
			}

			if (!missed) {
				dispatcherFunc.remove();
				argArrayBinding.path.remove();
				funcCacheBinding?.path.remove();
			}
		}
	});

	return changed;
};