import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import { asSingleStatement, dereferencePathFromBinding, getCallSites, getParentingCall, getPropertyName, isRemoved, pathAsBinding } from '../../utils.js';
import { filterBody, extractDateCheck, extractDomainLock } from './utils.js';

function isDefaultCountermeasure(path: NodePath): boolean {
	const stmt = asSingleStatement(path);
	if (!stmt?.isWhileStatement()) return false;
	if (!stmt.get('test').isBooleanLiteral({ value: true })) return false;

	const body = stmt.get('body');
	if (!body.isBlockStatement()) return false;
	if (body.node.body.length !== 0) return false;

	return true;
}

export default (path: NodePath) => {
	let changed = false;

	const state = {
		dateChecks: new Set<string>(),
		domainLocks: new Set<string>(),
		countermeasures: new Set<string>(),
	}
	path.traverse({
		CallExpression: {
			exit(call) {
				const callee = call.get('callee');
				if (!callee.isMemberExpression()) return;
				if (getPropertyName(callee) !== 'test') return;

				const regexp = callee.get('object')
				if (!regexp.isIdentifier()) return;
				const resolved = regexp.resolve();
				if (resolved.isNewExpression()) {
					if (!resolved.get('callee').isIdentifier({ name: 'RegExp'})) return;
					if (!resolved.get('arguments.0')?.isStringLiteral({ value: '\n' })) return;
				} else {
					return;
				}

				const target = call.get('arguments.0');

				// const regexpBinding = pathAsBinding(regexp);
				
				const outerFunc = call.getFunctionParent()?.getFunctionParent();
				let outerFuncBinding;
				if (outerFunc?.isFunctionDeclaration()) {
					outerFuncBinding = pathAsBinding(outerFunc);
				} else if (outerFunc?.isFunctionExpression()) {
					const decl = outerFunc.parentPath;
					if (!decl.isVariableDeclarator()) return;

					outerFuncBinding = pathAsBinding(decl);
				}

				if (!outerFuncBinding) return;

				// TODO(priority): progressively deobf and extract countermeasures

				if (outerFuncBinding.references !== 2) return;
				
				let isTested = false;
				let outerCall;
				for (const ref of outerFuncBinding.referencePaths) {
					if (target.isAncestor(ref) || target === ref) {
						isTested = true;
						continue;
					}
					
					const call = getParentingCall(ref);
					if (!call) continue;
					outerCall = call;
				}

				if (!isTested) return;
				if (!outerCall) return;

				const ret = outerCall.parentPath;
				if (ret.isReturnStatement() && call.key === 'argument') {
					ret.remove();
				} else {
					outerCall.remove();
				}

				outerFuncBinding.path.remove();
				changed = true;

				const lockFunction = outerCall.getFunctionParent();
				if (!lockFunction) return;

				const lockFunctionBody = lockFunction?.get('body');
				if (!lockFunctionBody?.isBlockStatement()) return;
				if (filterBody(lockFunctionBody.get('body')).length === 0) {
					const call = getParentingCall(lockFunction);
					if (call) {
						const stmt = call.parentPath;
						if (stmt.isExpressionStatement()) {
							stmt.remove();
						}
					}
				}
			}
		},
		FunctionDeclaration(func) {
			const state = { hasNativeCodeCheck: false };
			func.traverse({
				StringLiteral(str) {
					if (str.node.value === '{ [native code] }') {
						this.hasNativeCodeCheck = true;
						str.stop();
					}
				},
			}, state);

			if (!state.hasNativeCodeCheck) return;

			const binding = pathAsBinding(func);
			if (!binding || binding.constantViolations.length > 1) return;

			if (!getCallSites(binding).some(({call}) => {
				const globalObject = call.get('arguments.0');
				if (!globalObject.isIdentifier()) return false;
				if (Object.hasOwn(globalObject.scope.globals, globalObject.node.name)) {
					return true;
				}

				return false;
			})) return;

			for (const {call, ref} of getCallSites(binding)) {
				const args = call.get('arguments');
				if (args.length === 1) {
					const object = args[0];
					if (!object.isExpression()) continue;

					call.replaceWith(object.node);
				} else if (args.length === 2) {
					const [object, property] = args;
					if (!object.isExpression()) continue;
					if (!property.isStringLiteral()) continue;

					call.replaceWith(t.memberExpression(
						object.node,
						property.node,
						true,
					));
					changed = true;
				} else {
					continue;
				}

				dereferencePathFromBinding(binding, ref);
			}

			if (binding.referencePaths.every(isRemoved)) {
				binding.path.remove();
				changed = true;
			}
		},
		UnaryExpression(expr) {
			if (expr.node.operator !== 'delete') return;
			
			const memberExpr = expr.get('argument');
			if (!memberExpr.isMemberExpression()) return;
			if (getPropertyName(memberExpr) !== 'length') return;
			
			// TODO(priority) extract and match more

			const func = expr.getFunctionParent();
			if (!func) return;

			const lockFunction = func.getFunctionParent();
			if (!lockFunction) return;
			const call = getParentingCall(lockFunction);
			if (call) {
				const stmt = call.parentPath;
				if (stmt.isExpressionStatement()) {
					stmt.remove();
					changed = true;
				}
			}
		},
		IfStatement(ifStmt) {
			if (ifStmt.node.alternate) return;
			const test = ifStmt.get('test');
			
			const dateCheck = extractDateCheck(test);
			const domainLock = extractDomainLock(test);
			if (dateCheck !== null || domainLock !== null) {
				if (isDefaultCountermeasure(ifStmt.get('consequent'))) {
					ifStmt.remove();
					changed = true;
				}
			}

			if (dateCheck) {
				switch (dateCheck.type) {
				case 'start':
					this.dateChecks.add('Start date: ' + new Date(dateCheck.value));
					break;
				case 'end':
					this.dateChecks.add('End date: ' + new Date(dateCheck.value));
					break;
				}
			}

			if (domainLock) {
				this.domainLocks.add(domainLock);
			}
		}
	}, state);

	if (state.dateChecks.size > 0) {
		path.addComment(
			'leading',
			['', ...state.dateChecks, ''].join('\n'),
			false,
		)
	}

	if (state.domainLocks.size > 0) {
		path.addComment(
			'leading',
			['', 'Domain lock(s):', ...state.domainLocks, ''].join('\n'),
			false,
		)
	}

	return changed;
}