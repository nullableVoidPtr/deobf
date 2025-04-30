import * as t from '@babel/types';
import { Binding, type NodePath } from '@babel/traverse';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { asSingleStatement, getParentingCall, getPropertyName, pathAsBinding } from '../../utils.js';
import * as DeadCodeRemovalPass from './DeadCodeRemovalPass.js';
import * as BlockStatementPass from '../BlockStatementPass.js';
import TargetComposer from '../../targets/TargetComposer.js';
import * as ASTDescramblePass from './ASTDescramblePass.js';
import * as ConditionalStatementPass from '../ConditionalStatementPass.js';
import * as UnshuffleArrayPass from './UnshuffleArrayPass.js';
import * as LiteralFoldPass from '../LiteralFoldPass.js';
import * as LiteralOutliningPass from './LiteralOutliningPass.js';
import * as DotNotationPass from '../DotNotationPass.js';
import * as UnmaskVariablePass from './UnmaskVariablePass.js';
import * as StringPass from './StringPass/mod.js';
import * as GlobalObjectPass from './GlobalObjectPass.js';
import * as CalculatorInlinePass from './CalculatorInlinePass.js';
import * as DummyFunctionPass from './DummyFunctionPass.js';
import * as UnhoistPass from './UnhoistPass.js';
import * as UnflattenControlFlowPass from './UnflattenControlFlowPass/mod.js';
import { filterBody } from './utils.js';
import * as FixParametersPass from './FixParametersPass.js';

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (_traverse as any).default;

const innerTarget = TargetComposer([
	BlockStatementPass,
	ASTDescramblePass,
	[ConditionalStatementPass],
	UnhoistPass,
	UnflattenControlFlowPass,
	LiteralFoldPass,
	FixParametersPass,
	UnshuffleArrayPass,
	LiteralFoldPass,
	LiteralOutliningPass,
	LiteralFoldPass,
	DotNotationPass,
	FixParametersPass,
	UnmaskVariablePass,
	DummyFunctionPass,
	DeadCodeRemovalPass,
	StringPass,
	LiteralFoldPass,
	DotNotationPass,
	GlobalObjectPass,
	CalculatorInlinePass,
	DummyFunctionPass,
	LiteralFoldPass,
	DotNotationPass,
	DeadCodeRemovalPass,
]);

function liftRuntimeFunc(body: NodePath<t.Statement>[]): t.FunctionExpression | null {
	if (body.length !== 2) return null;
	const [func, outerRet] = body;
	if (!func.isFunctionDeclaration()) return null;
	const id = func.node.id;
	if (!id || !outerRet.isExpressionStatement() || !outerRet.get('expression').isIdentifier({ name: id.name })) return null;

	let liftedFunc = t.functionExpression(
		id,
		func.node.params,
		func.node.body,
		func.node.generator,
		func.node.async,
	);

	const funcBody = filterBody(func.get('body.body'));
	if (func.node.params.length === 0) {
		const argsDecn = funcBody.at(0);
		if (!argsDecn?.isVariableDeclaration()) return liftedFunc;

		const decls = argsDecn.get('declarations');
		if (decls.length !== 1) return liftedFunc;

		const [argsDecl] = decls;
		if (!argsDecl.get('init').isIdentifier({ name: 'arguments'})) return liftedFunc;
		const trueParams = argsDecl.get('id');
		if (!trueParams.isArrayPattern()) return liftedFunc;


		const newParams = [];
		for (const param of trueParams.get('elements')) {
			if (!param.hasNode()) return liftedFunc;
			if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) return liftedFunc;
			newParams.push(param.node);
		}

		argsDecn.remove();
		func.node.params = newParams;

		func.scope.crawl();

		liftedFunc = t.functionExpression(
			id,
			func.node.params,
			func.node.body,
			func.node.generator,
			func.node.async,
		)
	}

	if (liftedFunc.params.length !== 2) return liftedFunc;
	if (liftedFunc.body.body.length !== 2) return liftedFunc;

	const innerFunc = funcBody.at(-2);
	if (!innerFunc?.isFunctionDeclaration()) return liftedFunc;
	const innerFuncId = innerFunc.node.id;
	if (!innerFuncId) return liftedFunc;

	const ret = funcBody.at(-1);
	if (!ret?.isReturnStatement()) return liftedFunc;
	const innerCall = ret.get('argument');
	if (!innerCall.isCallExpression() || !innerCall.get('callee').matchesPattern(`${innerFuncId.name}.apply`)) return liftedFunc;
	const innerCallArgs = innerCall.get('arguments');
	if (innerCallArgs.length !== 2) return liftedFunc;

	if (!innerCallArgs[0].isThisExpression()) return liftedFunc;
	if (!t.isIdentifier(liftedFunc.params[1]) || !innerCallArgs[1].isIdentifier({ name: liftedFunc.params[1].name })) return liftedFunc;

	let funcArrayParam = liftedFunc.params[0];
	if (t.isIdentifier(funcArrayParam) && innerFunc.scope.hasBinding(funcArrayParam.name)) {
		const newName = innerFunc.scope.generateUid(funcArrayParam.name);
		func.scope.rename(funcArrayParam.name, newName);
		funcArrayParam = t.identifier(newName);
	}

	return t.functionExpression(
		id,
		[funcArrayParam, t.arrayPattern(innerFunc.node.params)],
		innerFunc.node.body,
		innerFunc.node.generator,
		innerFunc.node.async,
	);
}


export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		FunctionDeclaration(dummyFunc) {
			const params = dummyFunc.get('params');
			if (params.length !== 1) return;
			
			const pattern = params[0];
			if (!pattern.isAssignmentPattern()) return;
			if (!pattern.get('right').isBooleanLiteral({ value: true })) return;
			const boolParam = pattern.get('left');

			if (!boolParam.isIdentifier()) return;

			const ret = asSingleStatement(dummyFunc.get('body'));
			if (!ret?.isReturnStatement() || !ret.get('argument').isIdentifier({ name: boolParam.node.name })) return;

			const binding = pathAsBinding(dummyFunc);
			if (!binding?.constant) return;

			let missed = false;
			for (const ref of binding.referencePaths) {
				const call = ref.parentPath;
				if (!call?.isCallExpression()) {
					missed = true;
					continue;
				}

				let value: t.Expression = t.booleanLiteral(true);
				const args = call.get('arguments');
				if (args.length > 0) {
					const arg = args[0];
					if (!arg.isExpression()) {
						missed = true;
						continue;
					}

					value = arg.node;
				}

				call.replaceWith(value);
				changed = true;
				
				const usage = call.parentPath;
				if (usage.isVariableDeclarator()) {
					const usageBinding = pathAsBinding(usage);
					if (!usageBinding?.constant) continue;

					for (const ref of usageBinding.referencePaths) {
						ref.replaceWith(value);
					}

					usage.remove();
				}
			}

			if (!missed) {
				dummyFunc.remove();
				changed = true;
			}
		},
		CallExpression(call) {
			if (!call.get('callee').isIdentifier({ name: 'eval' })) return;

			const code = call.get('arguments.0');
			if (!code.isStringLiteral()) return;

			let predicateId;
			try {
				const parsed = parse(code.node.value);
				if (parsed.program.body.length !== 1) return;

				const stmt = parsed.program.body[0];
				if (!t.isExpressionStatement(stmt)) return;
				const assign = stmt.expression;
				if (!t.isAssignmentExpression(assign, { operator: '=' })) return;
				if (!t.isBooleanLiteral(assign.right, { value: true })) return;

				if (!t.isIdentifier(assign.left)) return;

				predicateId = assign.left.name;
			} catch {
				return;
			}

			const binding = call.scope.getBinding(predicateId);
			if (!binding) return;

			if (binding.references !== 1) return;
			// TODO(priority): capture countermeasure, more robust

			const func = call.getFunctionParent();
			if (!func?.isFunctionDeclaration()) return;
			const funcBinding = pathAsBinding(func);
			if (!funcBinding) return;
			
			const state = { trueReturn: false };
			func.traverse({
				ReturnStatement(retStmt) {
					const value = retStmt.get('argument');
					if (!value.isIdentifier()) return;
					this.trueReturn = true;
					path.stop();
				},
				Function(path) {
					path.skip();
				}
			}, state);

			let missed = false;
			for (const ref of funcBinding.referencePaths) {
				const call = ref.parentPath;
				if (!call?.isCallExpression()) {
					missed = true;
					continue;
				}

				let value: t.Expression = t.booleanLiteral(true);
				const args = call.get('arguments');
				if (args.length > 0) {
					const arg = args[0];
					if (!arg.isExpression()) {
						missed = true;
						continue;
					}

					value = arg.node;
				}

				call.replaceWith(value);
				changed = true;
				
				const usage = call.parentPath;
				if (usage.isVariableDeclarator()) {
					const usageBinding = pathAsBinding(usage);
					if (!usageBinding?.constant) continue;

					for (const ref of usageBinding.referencePaths) {
						ref.replaceWith(value);
					}

					usage.remove();
				}
			}

			if (!missed) {
				func.remove();
				changed = true;
			}
		}
	});

	DeadCodeRemovalPass.default(path);

	const state = { arrayCandidates: new Map<Binding, NodePath<t.ArrayExpression>>() };
	path.traverse({
		FunctionDeclaration(evalFunc) {
			const params = evalFunc.get('params');
			if (params.length !== 1) return;
			
			const funcStr = params[0];
			if (!funcStr.isIdentifier()) return;

			const ret = asSingleStatement(evalFunc.get('body'));
			if (!ret?.isReturnStatement() ) return;
			const innerFunc = ret.get('argument');
			if (!innerFunc.isCallExpression() || !innerFunc.get('callee').isIdentifier({ name: 'eval' })) return;
			const evalArgs = innerFunc.get('arguments');
			if (evalArgs.length !== 1) return;
			if (!evalArgs[0].isIdentifier({ name: funcStr.node.name })) return;

			const binding = pathAsBinding(evalFunc);
			if (!binding) return;

			if (!binding.constant) return;

			for (const ref of binding.referencePaths) {
				const call = ref.parentPath;
				if (!call?.isCallExpression()) continue;

				const array = call.parentPath;
				if (!array.isArrayExpression()) continue;

				const decl = array.parentPath;
				if (!decl.isVariableDeclarator()) continue;

				const binding = pathAsBinding(decl);
				if (!binding) continue;

				if (this.arrayCandidates.has(binding)) continue;
				this.arrayCandidates.set(binding, array);
			}

			let missed = false;
			for (const ref of binding.referencePaths) {
				const call = ref.parentPath;
				if (!call?.isCallExpression()) {
					missed = true;
					continue;
				}

				const args = call.get('arguments');
				if (args.length < 1) return;
				const arg = args[0];
				if (!arg.isStringLiteral()) {
					missed = true;
					continue;
				}

				const parsed = parse(arg.node.value);

				const state: { func: t.FunctionExpression | null } = { func: null }
				traverse(parsed, {
					Program(wrappedFunc) {
						innerTarget.deobfuscate(wrappedFunc);

						const body = filterBody(wrappedFunc.get('body'));
						const liftedFunc = liftRuntimeFunc(body);
						if (liftedFunc) {
							this.func = liftedFunc;
						} else {
							this.func = t.functionExpression(
								null,
								[],
								t.blockStatement(body.map(p => p.node)),
							)
						}
					},
				}, undefined, state);

				if (!state.func) {
					missed = true;
					continue;
				}

				call.replaceWith(state.func);
			}

			if (!missed) {
				evalFunc.remove();
				changed = true;
			}
		}
	}, state);

	for (const [arrayBinding, funcArray] of state.arrayCandidates.entries()) {
		const funcs = funcArray.get('elements');
		if (!funcs.every(p => p.isFunctionExpression())) continue;

		for (const ref of arrayBinding.referencePaths) {
			const memberExpr = ref.parentPath;
			if (!memberExpr?.isMemberExpression() || ref.key !== 'object') continue;
			const indexPath = memberExpr.get('property');
			if (!indexPath.isNumericLiteral()) continue;

			const innerFunc = funcs[indexPath.node.value];
			if (!innerFunc.isFunctionExpression()) continue;
			const funcParams = innerFunc.get('params');
			if (funcParams.length !== 2) continue;

			const [arrayRef, innerArgPattern] = funcParams;
			if (!arrayRef.isIdentifier()) continue;
			if (!innerArgPattern.isArrayPattern()) continue;

			const apply = memberExpr.parentPath;
			if (!apply?.isMemberExpression() || memberExpr.key !== 'object') continue;
			if (getPropertyName(apply) !== 'apply') continue;

			const call = getParentingCall(apply);
			if (!call) continue;
			const applyArgs = call.get('arguments');
			if (applyArgs.length !== 2) continue;
			if (!applyArgs[0].isThisExpression()) continue;

			const argArray = applyArgs[1];
			if (!argArray.isArrayExpression()) continue;
			const args = argArray.get('elements');
			if (args.length !== 2) continue;
			if (!args[0].isIdentifier({ name: arrayBinding.identifier.name })) continue;
			if (!args[1].isIdentifier({ name: 'arguments' })) continue;

			const ret = call.parentPath;
			if (!ret.isReturnStatement()) continue;

			const block = ret.parentPath;
			if (!block.isBlockStatement() || ret.key !== 0) continue;
			const actualFunc = block.parentPath;
			if (!actualFunc.isFunction()) continue;

			const newParams = [];
			for (const param of innerArgPattern.get('elements')) {
				if (!param.hasNode()) continue;
				if (!param.isPattern() && !param.isIdentifier() && !param.isRestElement()) continue;
				newParams.push(param.node);
			}
			actualFunc.node.params = newParams;
			block.replaceWith(t.cloneNode(innerFunc.node.body, true));

			const funcArrayBinding = pathAsBinding(arrayRef);
			if (funcArrayBinding?.constant) {
				for (const arrayRef of funcArrayBinding.referencePaths) {
					arrayRef.replaceWith(t.identifier(arrayBinding.identifier.name));
				}
			} else {
				block.unshiftContainer('body',
					t.variableDeclaration(
						'var',
						[t.variableDeclarator(arrayRef.node, t.identifier(arrayBinding.identifier.name))]
					),
				);
			}

			actualFunc.scope.crawl();
		}

		arrayBinding.scope.crawl();

		const newBinding = arrayBinding.scope.getBinding(arrayBinding.identifier.name);
		if (!newBinding?.referenced) {
			arrayBinding.path.remove();
		}
	}

	return changed;
};