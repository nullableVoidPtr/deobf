import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import * as bq from 'babylon-query';
import { pathAsBinding } from '../../utils.js';

const innerFuncSelector = bq.parse(
	`FunctionExpression:has(VariableDeclarator
        > ConditionalExpression.init:has(
            > Identifier.test
        ):has(
            FunctionExpression.alternate
        )
        > FunctionExpression.consequent
        VariableDeclarator
        > CallExpression.init:has(
            > Identifier.arguments.0
        ):has(
            > Identifier.arguments.1[name='arguments']
        )
        > MemberExpression.callee:has(
            > Identifier.object
        )
        > Identifier.property[name='apply']
    )`);
const domainLockSelector = bq.parse(`VariableDeclarator
	> CallExpression:has(
		> MemberExpression.callee
		> Identifier[name='split']
	)
`)
const debugProtSelector = bq.parse(`ReturnStatement
    > CallExpression.argument:has(
        > StringLiteral.arguments.0[value='counter']
    )
    > MemberExpression:has(
        > Identifier.property[name='apply']
    )
    > CallExpression.object:has(
        > MemberExpression.callee
        > Identifier.property[name='constructor']
    )
    > StringLiteral.arguments.0[value='while (true) {}']`);
const debugCallSelector = bq.parse(`CallExpression
    > FunctionExpression
    CallExpression:has(
        > MemberExpression.callee
        > Identifier.property[name='setInterval']
    ):has(
        > NumericLiteral.arguments.1
    )
    > Identifier.arguments.0`);

function findDomainLock(path: NodePath): string[] | null {
	const domainLockMatches = bq.query(path, domainLockSelector);
	if (domainLockMatches.length === 0) {
		return null;
	}

	const domainLockCall = domainLockMatches[0];
	if (!domainLockCall.isCallExpression()) {
		return null;
	}

	const delimiterPath = domainLockCall.get('arguments.0') as NodePath;
	if (!delimiterPath.isStringLiteral()) {
		return null;
	}
	const delimiter = delimiterPath.node.value;

	const obfuscatedDomainsPath = domainLockCall.get('callee.object.callee.object') as NodePath;
	if (!obfuscatedDomainsPath.isStringLiteral()) {
		return null;
	}
	const obfuscatedDomain = obfuscatedDomainsPath.node.value;

	const state: { regex?: RegExp } = {}
	domainLockCall.traverse({
		Identifier(regexId) {
			const binding = pathAsBinding(regexId);
			const varPath = binding?.path
			if (!varPath?.isVariableDeclarator()) return;

			const regexCall = varPath.get('init');
			if (!regexCall.isNewExpression()) return;
			if (!regexCall.get('callee').isIdentifier({name: 'RegExp'})) return;

			const regexArgs: string[] = [];
			for (const arg of regexCall.get('arguments')) {
				if (!arg.isStringLiteral()) return;
				regexArgs.push(arg.node.value);
			}

			try {
				const regex = new RegExp(regexArgs[0], regexArgs[1]);
				this.regex = regex;
				regexId.stop();
			} catch {
				return;
			}
		}
	}, state);

	if (!state.regex) {
		return null;
	}

	try {
		return obfuscatedDomain.replace(state.regex, '').split(delimiter);
	} catch {
		return null;
	}
}

export default (treePath: NodePath): boolean => {
	let changed = false;

	treePath.traverse({
		VariableDeclarator(varPath) {
			const callControllerInit = varPath.get('init');
			if (!callControllerInit.isCallExpression()) return;

			const callController = callControllerInit.get('callee');
			if (!callController.isFunctionExpression()) return;
			const body = callController.get('body.body') as NodePath<t.Statement>[];
			if (body.length !== 2) return;

			const [declarations, returnStmt] = body;
			if (!declarations.isVariableDeclaration()) return;
			if (!returnStmt.isReturnStatement()) return;

			const innerClosure = returnStmt.get('argument');
			if (!innerClosure.isFunctionExpression()) return;

			const params = innerClosure.get('params');
			if (params.length !== 2) return;
			if (!params.every((p) => p.isIdentifier())) return;

			if (!bq.matches(innerClosure, innerFuncSelector, {})) return;

			const binding = Object.values(varPath.scope.getAllBindings()).find(b => b.path === varPath);
			if (!binding) return;

			for (const bindingRef of binding.referencePaths) {
				const initCall = bindingRef.parentPath;
				if (!initCall?.isCallExpression()) continue;

				const wrappedUse = initCall.parentPath;
				if (wrappedUse?.isVariableDeclarator()) {
					const wrappedBinding = pathAsBinding(wrappedUse);
					if (!wrappedBinding) continue;

					for (const wrappedRef of wrappedBinding.referencePaths) {
						if (wrappedRef.isDescendant(wrappedUse)) continue;
						if (wrappedRef.parentPath?.isCallExpression()) {
							wrappedRef.parentPath.remove();
							changed = true;
						}
					}

					const domains = findDomainLock(wrappedBinding.path);
					if (domains && domains.length > 0) {
						let comment = '* Domain-locked to:\n';
						comment += domains.map(p => ' ' + p + '\n').join('');
						treePath.addComment('leading', comment);
					}
					wrappedBinding.path.remove();
				} else if (wrappedUse?.isCallExpression()) {
					const callStmt = wrappedUse.parentPath;
					if (callStmt?.isExpressionStatement()) {
						callStmt.remove();
						changed = true;
					}
				}

				if (!varPath.removed) {
					varPath.remove();
					changed = true;
				}
			}
		},
		FunctionDeclaration(path) {
			const body = path.get('body.body') as NodePath<t.Statement>[];
			if (body.length !== 2) return;

			const innerFunc = body[0];
			const matches = bq.query(innerFunc, debugProtSelector);
			if (matches.length !== 1) return;

			const binding = pathAsBinding(path);
			if (binding) {
				for (const reference of binding.referencePaths) {
					if (path.isAncestor(reference)) continue;

					if (!bq.matches(
						reference,
						debugCallSelector,
						{}
					)) continue;

					const outerDebugProtFunc = reference.getFunctionParent()?.parentPath;
					if (!outerDebugProtFunc) {
						console.warn('found inner debug protection function, but could not remove entirely')
					} else {
						outerDebugProtFunc.remove();
					}
					changed = true;
				}
			}

			path.remove();
		}
	});

	const emptyIIFEMatches = bq.query(
		treePath,
		`ExpressionStatement:has(
            > CallExpression.expression
            > FunctionExpression.callee
            > BlockStatement[body.length=0]
        )`
	);
	for (const iife of emptyIIFEMatches) {
		iife.remove();
		changed = true;
	}

	return changed;
}