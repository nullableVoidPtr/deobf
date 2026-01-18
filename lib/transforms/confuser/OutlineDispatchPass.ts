import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { asSingleStatement, dereferencePathFromBinding, getCallLikeSites, getPropertyName, isRemoved, pathAsBinding } from '../../utils.js';
import { filterBody } from './utils.js';
import { unhoistFunctionParams } from './UnhoistPass.js';

function fixDispatchedFunction(func: NodePath<t.FunctionExpression>, newFuncName: string, argsArrayName: string) {
	if (func.node.params.length !== 0) {
		unhoistFunctionParams(func, 0);

		const newVars: string[] = [];
		for (const param of func.node.params) {
			if (param.type !== 'Identifier') return null;
			newVars.push(param.name);
		}

		if (newVars.length > 0) {
			func.get('body').unshiftContainer(
				'body',
				t.variableDeclaration(
					'var',
					newVars.map(id => t.variableDeclarator(t.identifier(id))),
				),
			);
		}
	}

	const body = filterBody(func.get('body.body'));
	let argsDecn: NodePath | null = null
	let argsPattern: NodePath | null = null;
	for (const stmt of body) {
		if (stmt?.isFunctionDeclaration()) continue;
		if (!stmt?.isVariableDeclaration()) break;
		if (stmt.node.declarations.length !== 1) continue;

		const argsDecl = stmt.get('declarations.0');
		if (!argsDecl.get('init').isIdentifier({ name: argsArrayName })) continue;

		argsPattern = argsDecl.get('id');
		argsDecn = stmt;
		break;
	}
	
	const newParams = [];
	if (argsPattern?.isArrayPattern()) {
		for (const param of argsPattern.get('elements')) {
			if (!param.hasNode()) return null;
			if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) return null;
			newParams.push(param.node);
		}
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

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		ObjectExpression(funcsObj) {
			const funcs = new Map<string, NodePath<t.FunctionExpression>>();
			for (const property of funcsObj.get('properties')) {
				if (!property.isObjectProperty()) return;
				const func = property.get('value');
				if (!func.isFunctionExpression()) return;

				const key = getPropertyName(property);
				if (key === null) return;

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

				const key = getPropertyName(property);
				if (key === null) return;

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
			const objReturnProp = objReturnObj.get('properties.0');
			if (!objReturnProp.isObjectProperty()) return;
			const objReturnKey = getPropertyName(objReturnProp);
			if (objReturnKey === null) return;

			let alternate: NodePath<t.Node | null | undefined> = objReturnIfStmt.get('alternate');
			if (!alternate.hasNode()) {
				alternate = objReturnIfStmt.getNextSibling();
			} else if (alternate.isBlockStatement()) {
				alternate = alternate.get('body.0');
			}
			if (!alternate.isReturnStatement()) return;

			const outlinedFuncs = new Map<string, string | null>();
			for (const { call, ref } of getCallLikeSites(dispatcherBinding)) {
				const dispatcherArgs = call.get('arguments');
				if (dispatcherArgs.length < 1) continue;
				
				const nameArg = dispatcherArgs[0];
				if (!nameArg.isStringLiteral()) continue;

				const funcName = nameArg.node.value
				let outlinedFuncName = outlinedFuncs.get(funcName);
				if (outlinedFuncName === null) {
					continue;
				} else if (outlinedFuncName === undefined) {
					const func = funcs.get(nameArg.node.value);
					if (!func) {
						continue;
					}

					const generatedName = dispatcherBinding.scope.generateUid(funcName);
					const outlined = fixDispatchedFunction(func, generatedName, argArrayBinding.identifier.name);
					if (!outlined) {
						outlinedFuncs.set(funcName, null);
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
					if (getPropertyName(memberExpr) === objReturnKey) {
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
						let argAssign: NodePath<t.Expression>;

						const toRemove: NodePath[] = [];
						const sequence = ancestor.parentPath;
						if (sequence?.isExpressionStatement()) {
							const prev = sequence.getPrevSibling();
							if (!prev.isExpressionStatement()) {
								continue;
							}
							
							toRemove.push(prev);
							argAssign = prev.get('expression');
						} else if (sequence?.isSequenceExpression()) {
							argAssign = ancestor.getPrevSibling() as NodePath<t.Expression>;
							ancestor = sequence;
						} else {
							continue;
						}

						if (!argAssign.isAssignmentExpression({ operator: '=' })) continue;
						const argAssignee = argAssign.get('left');
						if (!argAssignee.isIdentifier({ name: argArrayBinding.identifier.name })) continue;
						dereferencePathFromBinding(argArrayBinding, argAssignee);

						const array = argAssign.get('right');
						if (!array.isArrayExpression()) {
							continue;
						}

						const elements = array.get('elements');
						if (!elements.every(e => e.hasNode())) {
							continue;
						}

						args.push(...<(t.Expression | t.SpreadElement)[]>elements.map(e => e.node));
						for (const node of toRemove) {
							node.remove();
						}
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
				dereferencePathFromBinding(dispatcherBinding, ref);
				changed = true;
			}

			if (dispatcherBinding.referencePaths.every(isRemoved)) {
				dispatcherBinding.path.remove();
				argArrayBinding.path.remove();
				funcCacheBinding?.path.remove();
			}
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
};