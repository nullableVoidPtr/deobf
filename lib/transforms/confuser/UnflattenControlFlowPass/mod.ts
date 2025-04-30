import { type NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import { filterBody, extractHoistedDecl } from '../utils.js';
import { asSingleStatement, dereferencePathFromBinding, getPropertyName, isUndefined, pathAsBinding } from '../../../utils.js';
import { FlatControlFlow } from './controlFlow.js';
import { outlineCallAsFunc as restructureCallAsFunc } from './restructure.js';
import { blockStatement, expressionStatement, Statement } from '@babel/types';
import UnhoistPass from '../UnhoistPass.js';

function getWrappedFunc(controlFlow: FlatControlFlow, path: NodePath) {
	const func = path.getFunctionParent();
	if (!func?.isFunction()) return;

	const block = func.get('body');
	if (!block.isBlockStatement()) return;

	UnhoistPass(func);
	func.scope.crawl();

	const body: NodePath<Statement>[] = [];
	for (const stmt of block.get('body')) {
		if (stmt === controlFlow.flattenedFunc) continue;
		if (extractHoistedDecl(stmt)?.value === controlFlow.flattenedFunc) continue;

		body.push(stmt);
	}
	if (body.length < 3) return;

	const returnStmt = body.pop();
	const returnValueDecn = body.pop();
	const returnCondDecn = body.pop();

	if (!returnCondDecn) return;
	let returnCond: NodePath | null = null;
	if (returnCondDecn.isVariableDeclaration()) {
		const returnCondDecls = returnCondDecn.get('declarations');
		if (returnCondDecls.length !== 1) return;
		const [returnCondDecl] = returnCondDecls;
		const init = returnCondDecl.get('init');
		if (init.hasNode() && !isUndefined(init)) {
			return;
		}
		returnCond = returnCondDecl.get('id');
	} else {
		if (!returnCondDecn.isExpressionStatement()) return;

		const assign = returnCondDecn.get('expression');
		if (!assign.isAssignmentExpression({ operator: '=' })) return;

		if (!isUndefined(assign.get('right'))) return;
		returnCond = assign.get('left');
	}

	if (!returnCond?.isIdentifier()) return;
	const condBinding = pathAsBinding(returnCond);
	if (!condBinding) return;
	if (condBinding.references !== 1) return;

	if (!returnValueDecn) return;
	let returnValue;
	let returnId: string;
	if (returnValueDecn.isVariableDeclaration()) {
		const returnValueDecls = returnValueDecn.get('declarations');
		if (returnValueDecls.length !== 1) return;
		const [returnValueDecl] = returnValueDecls;
		returnValue = returnValueDecl.get('init');
		const id = returnValueDecl.get('id');
		if (!id.isIdentifier()) return;
		returnId = id.node.name;
	} else {
		const hoist = extractHoistedDecl(returnValueDecn);
		if (!hoist) return;
		returnValue = hoist.value;

		const binding = pathAsBinding(hoist.param);
		if (binding?.references !== 1) return;
		returnId = hoist.param.node.name;
		binding.path.remove();
	}


	if (controlFlow.flattenedFunc.node.generator) {
		// TODO
		if (!returnValue.isAncestor(path)) {
			if (path.getStatementParent() !== returnValue.getStatementParent()) return;
		}
	} else {
		if (!returnValue.isCallExpression() || returnValue.node.arguments.length > 0) return;
	}
	
	if (!returnStmt?.isIfStatement()) return;
	if (!returnStmt.get('test').isIdentifier({ name: returnCond.node.name })) return;
	const consequent = asSingleStatement(returnStmt.get('consequent'));
	const alternate = asSingleStatement(returnStmt.get('alternate'));

	if (!consequent?.isReturnStatement() || !consequent.get('argument').isIdentifier({ name: returnId })) return;
	if (alternate) {
		if (!alternate.isReturnStatement()) return;
		const value = alternate.get('argument');
		if (value.hasNode() && !isUndefined(value)) return;
	}

	return {
		wrappedFunc: func,
		condBinding,
		ifStmt: returnStmt,
		prologue: body,
	};
}

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		Function(flattenedFunc) {
			if (!flattenedFunc.isFunctionDeclaration() && !flattenedFunc.isFunctionExpression()) return;

			flattenedFunc.scope.parent.crawl();
			let binding;
			const toRemove: NodePath[] = [];
			if (flattenedFunc.isFunctionDeclaration()) {
				binding = pathAsBinding(flattenedFunc);
			} else if (flattenedFunc.isFunctionExpression()) {
				const hoist = extractHoistedDecl(flattenedFunc);
				if (!hoist) return;

				const { param, stmt } = hoist;
				toRemove.push(stmt);

				binding = pathAsBinding(param);
			}
			if (!binding) return;

			let flatControlFlow;
			try {
				flatControlFlow = new FlatControlFlow(flattenedFunc, binding);
			} catch (_) {
				return;
			}

			const externalCalls = binding.referencePaths.flatMap(ref => {
				if (flattenedFunc.isAncestor(ref)) return [];
				let call = ref.parentPath;
				let callee = ref;
				if (call?.isSequenceExpression()) {
					if (ref.key !== call.node.expressions.length - 1) return [];
					if (!call.getAllPrevSiblings().every(e => e.isPure())) return [];

					callee = call;
					call = call.parentPath;
				}

				if (!call?.isCallExpression() || callee.key !== 'callee') {
					return [];
				}

				return [{ref, call}];
			});
			for (const {ref, call} of externalCalls) {
				const flattenedReturn = getWrappedFunc(flatControlFlow, call);

				const result = restructureCallAsFunc(flatControlFlow, call, {
					inlineTarget: call,
				});
				if (!result) continue; // throw new Error();
				
				const {outlinedFunc, call: newCall, functionScopePredicates: programScopePredicates} = result;

				outlinedFunc.traverse({
					FunctionDeclaration(proxyFunc) {
						const params = proxyFunc.get('params');
						if (params.length !== 1) return;

						const restParam = params[0];
						if (!restParam.isRestElement()) return;

						const trueArgs = restParam.get('argument');
						if (!trueArgs.isIdentifier()) return;

						const block = proxyFunc.get('body');

						const body = filterBody(block.get('body'));
						if (body.length !== 1) return;

						const ret = body[0];

						if (!ret.isReturnStatement()) return;
						let target = ret.get('argument');
						if (target.isMemberExpression()) {
							if (getPropertyName(target) !== 'value') return;

							const nextCall = target.get('object');
							if (!nextCall.isCallExpression()) return;
							const next = nextCall.get('callee');
							if (!next.isMemberExpression()) return;
							if (getPropertyName(next) !== 'next') return;
							target = next.get('object');
						}
						if (!target.isCallExpression()) return;
						const callee = target.get('callee');
						if (!callee.isIdentifier({ name: this.binding.identifier.name })) return;

						const outlinedFunc = restructureCallAsFunc(
							this,
							target,
							{
								inlineTarget: proxyFunc,
								scopePredicates: programScopePredicates,
							}
						);

						if (outlinedFunc === null) return;

						// flattenedFunc.requeue(outlinedFunc.outlinedFunc);

						changed = true;
						dereferencePathFromBinding(binding, callee);
					},
				}, flatControlFlow);

				dereferencePathFromBinding(binding, ref);
				
				if (flattenedReturn) {
					for (const assign of flattenedReturn.condBinding.constantViolations) {
						assign.remove();

						const sequence = assign.parentPath;
						if (sequence?.isSequenceExpression() && sequence.node.expressions.length === 1) {
							sequence.replaceWith(sequence.node.expressions[0]);
						}
					}
					flattenedReturn.condBinding.path.remove();

					const actualBody = outlinedFunc.node.body;
					if (flattenedReturn.wrappedFunc.isAncestor(flattenedFunc)) {
						if (externalCalls.length !== 1) throw new Error();
						binding.path.remove();
					}
					flattenedReturn.wrappedFunc.get('body').replaceWith(blockStatement([
						...flattenedReturn.prologue.filter(p => !p.removed && p.hasNode()).map(p => p.node),
						...actualBody.body,
					]));

					flattenedFunc.requeue(flattenedReturn.wrappedFunc);

					changed = true;
				} else if (externalCalls.length === 1) {
					const last = outlinedFunc.get('body.body').at(-1);
					if (last?.isReturnStatement()) {
						const argument = last.get('argument');
						if (argument.hasNode()) {
							last.replaceWith(expressionStatement(argument.node));
						} else {
							last.remove();
						}
						changed = true;
					}

					if (!newCall) throw new Error();
					if (newCall.parentPath.isExpressionStatement()) {
						const newStmts = newCall.parentPath.replaceWithMultiple(outlinedFunc.node.body.body);
						for (const stmt of newStmts) {
							flattenedFunc.requeue(stmt);
						}
					}

					changed = true;
				}
			}

			flattenedFunc.parentPath.scope.crawl();
			if (!binding.path.removed && binding.referencePaths.every(ref => flattenedFunc.isAncestor(ref) || toRemove.every(p => p.isAncestor(ref)))) {
				binding.path.remove();
				changed = true;
			}
		}
	});

	return changed;
}