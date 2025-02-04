import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { pathAsBinding } from '../../utils.js';
import { filterBody } from './utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

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

			const body = filterBody(block.get('body'));
			if (body.length !== 2) return;

			const [flatObjDecn, ret] = body;
			
			if (!ret.isReturnStatement()) return;
			const call = ret.get('argument');
			if (!call.isCallExpression()) return;

			const flatFuncId = call.get('callee');
			if (!flatFuncId.isIdentifier()) return;

			const flatFuncBinding = pathAsBinding(flatFuncId);
			if (!flatFuncBinding) return;

			const args = call.get('arguments');
			if (args.length !== 2) return;

			const flatObjArg = args[1];
			if (!args[0].isIdentifier({ name: trueArgs.node.name })) return;
			if (!flatObjArg.isIdentifier()) return;

			if (!flatObjDecn.isVariableDeclaration()) return;
			const decls = flatObjDecn.get('declarations');
			if (decls.length !== 1) return;

			const [flatObjDecl] = decls;

			const flatObjExpr = flatObjDecl.get('init');
			if (!flatObjExpr.isObjectExpression()) return;

			const flatObjBinding = pathAsBinding(flatObjDecl);
			if (!flatObjBinding) return;

			if (flatObjBinding.references !== 1 || flatObjBinding.referencePaths[0] !== flatObjArg) return;

			const flatFunc = flatFuncBinding.path;
			if (flatFuncBinding.references !== 1 || flatFuncBinding.referencePaths[0] !== flatFuncId) return;
			if (!flatFunc.isFunctionDeclaration()) return;

			const flatParams = flatFunc.get('params');
			if (flatParams.length !== 2) return;
			const [trueParams, flatObjId] = flatParams;

			if (!trueParams.isArrayPattern()) return;
			if (!flatObjId.isIdentifier()) return;

			const newParams = [];
			for (const param of trueParams.get('elements')) {
				if (!param.hasNode()) return;
				if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) return;
				newParams.push(param.node);
			}

			func.node.params = newParams;
			flatFunc.node.body.body.unshift(
				t.variableDeclaration(
					flatObjDecn.node.kind,
					[t.variableDeclarator(flatObjId.node, flatObjDecl.get('init').node)],
				),
			);
			func.get('body').replaceWith(flatFunc.node.body);
			flatFunc.remove();
			changed = true;

			func.scope.crawl();

			const newFlatObjBinding = func.scope.getBinding(flatObjId.node.name);
			if (!newFlatObjBinding) return;

			let missed = false;
			const bindingProxies = new Map<string, t.Identifier>();
			const typeofProxies = new Map<string, t.Expression>();
			const callProxies = new Map<string, t.Expression>();

			function analyseProperty(property: NodePath) {
				if (property.isObjectMethod()) {
					const keyPath = property.get('key');
					let key;
					if (keyPath.isIdentifier()) {
						key = keyPath.node.name;
					} else if (keyPath.isStringLiteral()) {
						key = keyPath.node.value;
					} else {
						return false;
					}

					property.scope.crawl();

					if (property.node.kind == 'get') {
						const body = filterBody(property.get('body').get('body'));
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
						const body = filterBody(property.get('body').get('body'));
						if (body.length !== 1) return false;
						
						const stmt = body[0];
						if (!stmt.isExpressionStatement()) return false;

						const assign = stmt.get('expression');
						if (!assign.isAssignmentExpression({ operator: '=' })) return false;

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

						const body = filterBody(property.get('body').get('body'));
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

			for (const property of flatObjExpr.get('properties')) {
				missed = !analyseProperty(property) || missed;
			}

			for (const ref of newFlatObjBinding.referencePaths) {
				const memberExpr = ref.parentPath;
				if (!memberExpr?.isMemberExpression() || ref.key !== 'object') {
					missed = true;
					continue;
				}

				const property = memberExpr.get('property');
				let key;
				if (property.isIdentifier()) {
					key = property.node.name;
				} else if (property.isStringLiteral()) {
					key = property.node.value;
				} else {
					missed = true;
					continue;
				}

				const bindingProxy = bindingProxies.get(key);
				if (bindingProxy) {
					memberExpr.replaceWith(t.identifier(bindingProxy.name));
					continue;
				}

				const typeofProxy = typeofProxies.get(key);
				if (typeofProxy) {
					memberExpr.replaceWith(t.cloneNode(typeofProxy, true));
					continue;
				}

				const callProxy = callProxies.get(key);
				if (callProxy) {
					memberExpr.replaceWith(t.cloneNode(callProxy, true));
					continue;
				}
			}

			if (!missed) {
				newFlatObjBinding.path.remove();
			}
		}
	});

	return changed;
}