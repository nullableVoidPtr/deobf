import * as t from '@babel/types';
import type { Binding, NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { dereferencePathFromBinding, getPropertyName, isRemoved, pathAsBinding } from '../../utils.js';
import { filterBody } from './utils.js';

function extractFlatFuncParams(flatFunc: NodePath<t.FunctionDeclaration>) {
	const flatParams = flatFunc.get('params');
	if (flatParams.length !== 2) return null;
	const [trueParams, flatObjId] = flatParams;

	if (!trueParams.isArrayPattern()) return null;
	if (!flatObjId.isIdentifier()) return null;

	const newParams = [];
	for (const param of trueParams.get('elements')) {
		if (!param.hasNode()) return null;
		if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) return null;
		newParams.push(param.node);
	}

	return [newParams, flatObjId] as const;
}

function liftFlatObj(flatObjBinding: Binding) {
	let missed = false;
	const bindingProxies = new Map<string, t.Identifier>();
	const typeofProxies = new Map<string, t.Expression>();
	const callProxies = new Map<string, t.Expression>();

	function analyseProperty(property: NodePath) {
		if (property.isObjectMethod()) {
			const key = getPropertyName(property);
			if (key === null) {
				return false;
			}

			property.scope.crawl();

			if (property.node.kind == 'get') {
				const body = filterBody(property.get('body.body'));
				if (body.length !== 1) return false;
				
				const ret = body[0];
				if (!ret.isReturnStatement()) return false;

				const value = ret.get('argument');
				if (value.isUnaryExpression({ operator: 'typeof', prefix: true })) {
					typeofProxies.set(key, value.node);
				} else if (value.isIdentifier()) {
					const preexistingProxy = bindingProxies.get(key);
					if (preexistingProxy) {
						if (preexistingProxy.name !== value.node.name) return false;
					} else {
						bindingProxies.set(key, value.node);
					}
				}
			} else if (property.node.kind == 'set') {
				const body = filterBody(property.get('body.body'));
				if (body.length !== 1) return false;
				
				const stmt = body[0];
				let assign;
				if (stmt.isExpressionStatement()) {
					assign = stmt.get('expression');
				} else if (stmt.isReturnStatement()) {
					assign = stmt.get('argument');
				}

				if (!assign?.isAssignmentExpression({ operator: '=' })) return false;

				const target = assign.get('left');
				if (!target.isIdentifier()) return false;

				const preexistingProxy = bindingProxies.get(key);
				if (preexistingProxy) {
					if (preexistingProxy.name !== target.node.name) return false;
				} else {
					bindingProxies.set(key, target.node);
				}
			} else if (property.node.kind == 'method') {
				const params = property.get('params');
				if (params.length !== 1) return false;

				const restParam = params[0];
				if (!restParam.isRestElement()) return false;

				const argsArray = restParam.get('argument');
				if (!argsArray.isIdentifier()) return false;

				const body = filterBody(property.get('body.body'));
				if (body.length !== 1) return false;

				const ret = body[0];
				if (!ret.isReturnStatement()) return false;

				const call = ret.get('argument');
				if (!call.isCallExpression()) return false;

				const callee = call.get('callee');
				if (!callee.isExpression()) return false;

				const args = call.get('arguments');
				if (args.length !== 1) return false;

				const arg = args[0];
				if (!arg.isSpreadElement() || !arg.get('argument').isIdentifier({ name: argsArray.node.name })) return false;

				callProxies.set(key, callee.node);
			}
		} else {
			return false;
		}

		return true;
	}

	const flatObjExpr = flatObjBinding.path.resolve();
	if (!flatObjExpr.isObjectExpression()) return false;

	for (const property of flatObjExpr.get('properties')) {
		missed = !analyseProperty(property) || missed;
	}

	for (const ref of [...flatObjBinding.referencePaths]) {
		const memberExpr = ref.parentPath;
		if (!memberExpr?.isMemberExpression() || ref.key !== 'object') {
			continue;
		}

		const key = getPropertyName(memberExpr);
		if (key === null) {
			continue;
		}

		const bindingProxy = bindingProxies.get(key);
		if (bindingProxy) {
			memberExpr.replaceWith(t.identifier(bindingProxy.name));
			dereferencePathFromBinding(flatObjBinding, ref);
			continue;
		}

		const typeofProxy = typeofProxies.get(key);
		if (typeofProxy) {
			memberExpr.replaceWith(t.cloneNode(typeofProxy, true));
			dereferencePathFromBinding(flatObjBinding, ref);
			continue;
		}

		const callProxy = callProxies.get(key);
		if (callProxy) {
			memberExpr.replaceWith(t.cloneNode(callProxy, true));
			dereferencePathFromBinding(flatObjBinding, ref);
			continue;
		}
		
		missed = true;
	}

	return !missed;
}

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		Function(func) {
			const params = func.get('params');
			if (params.length !== 1) return;

			const restParam = params[0];
			if (!restParam.isRestElement()) return;

			const trueArgs = restParam.get('argument');
			if (!trueArgs.isIdentifier()) return;

			func.scope.crawl();

			const block = func.get('body');
			if (!block.isBlockStatement()) return;

			let innerFunc;
			let callStmt;
			const body = filterBody(block.get('body'));
			for (const stmt of body) {
				let call;
				if (stmt.isExpressionStatement()) {
					call = stmt.get('expression');
				} else if (stmt.isReturnStatement()) {
					call = stmt.get('argument');
				} else {
					continue;
				}

				if (!call.isCallExpression()) continue;
				callStmt = stmt;

				const callee = call.get('callee');
				if (!callee.isIdentifier()) continue;

				const binding = pathAsBinding(callee);
				if (!binding) continue;

				const flatFuncBinding = binding;
				const flatFunc = flatFuncBinding.path;
				if (!flatFunc.isFunctionDeclaration()) continue;
				const flatParams = extractFlatFuncParams(flatFunc);
				if (!flatParams) continue;
				const [newParams, flatObjParam] = flatParams;

				const args = call.get('arguments');
				const flatObjArg = args[1];
				if (!args[0].isIdentifier({ name: trueArgs.node.name })) continue;
				if (!flatObjArg.isIdentifier()) continue;

				const flatObjBinding = pathAsBinding(flatObjArg);
				if (!flatObjBinding) continue;

				let flatObjExpr = flatObjBinding.path.resolve();
				if (!flatObjExpr.isObjectExpression()) {
					if (flatObjBinding.constantViolations.length !== 1) continue;
					const assign = flatObjBinding.constantViolations[0];
					if (!assign.isAssignmentExpression({ operator: '=' })) continue;
					flatObjExpr = assign.get('right');
				}
				if (!flatObjExpr.isObjectExpression()) continue;
				if (!flatObjBinding.constant && flatObjBinding.constantViolations.length > 1) continue;
				if (flatObjBinding.references !== 1 || flatObjBinding.referencePaths[0] !== flatObjArg) continue;

				[flatObjExpr] = flatObjBinding.referencePaths[0].replaceWith(flatObjExpr.node);
				flatObjBinding.path.remove();
				flatObjBinding.constantViolations.map(assign => assign.remove());
				changed = true;

				if (!flatObjExpr.isObjectExpression()) continue;

				const flatFuncRefs = flatFuncBinding.referencePaths.filter(ref => !isRemoved(ref));
				if (flatFuncRefs.length !== 1 || flatFuncRefs[0] !== callee) continue;
				flatFunc.get('body').unshiftContainer(
					'body',
					t.variableDeclaration(
						'var',
						[t.variableDeclarator(flatObjParam.node, flatObjExpr.node)],
					),
				);
				func.node.params = newParams;
				[innerFunc] = callee.replaceWith(
					t.functionExpression(
						undefined,
						[],
						flatFunc.node.body,
						flatFunc.node.generator,
						flatFunc.node.async,
					),
				);
				args.map(a => a.remove());
				flatFunc.remove();

				const newFlatObjBinding = innerFunc.scope.getBinding(flatObjParam.node.name);
				if (!newFlatObjBinding) continue;

				if (liftFlatObj(newFlatObjBinding) && newFlatObjBinding.referencePaths.every(isRemoved)) {
					newFlatObjBinding.path.remove();
				}

				break;
			}

			if (callStmt && innerFunc) {
				const newBlock = func.get('body');
				if (!newBlock.isBlockStatement()) return;
				const newBody = filterBody(newBlock.get('body'));

				if (newBody.length === 1 && newBody[0] === callStmt) {
					newBlock.replaceWith(innerFunc.get('body'));
				}
			}
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
}