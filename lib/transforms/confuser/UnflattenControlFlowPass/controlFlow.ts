import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import { asSingleStatement } from '../../../utils.js';
import { extractComplexTest, extractScopeTest, type BlockTest } from './tests.js';
import { extractScopePattern, extractState, extractWithScope } from './extract.js';

export type ExtractedCase = [BlockTest[], NodePath<t.SwitchCase>];

export class FlatControlFlow {

	flattenedFunc: NodePath<t.FunctionDeclaration | t.FunctionExpression>;
	binding: Binding;
	stateParams: string[] = [];
	scopeBinding: Binding;
	mainScopeName: string;
	argsParam: string | null = null;
	switchLabel: string | null = null;
	switchStmt: NodePath<t.SwitchStatement>;
	stopState: number;
	optionalWithScopeKey: string;

	cases: ExtractedCase[] = [];
	caseOrder: Map<NodePath<t.SwitchCase>, number> = new Map();
	entrypoints: [number[], [t.Statement[], Record<string, object>]][] = [];
	scopeDeclarations: Record<string, Set<string>> = {};
	
	constructor(
		flattenedFunc: NodePath<t.FunctionDeclaration | t.FunctionExpression>,
		binding: Binding,
	) {
		this.flattenedFunc = flattenedFunc;
		this.binding = binding;

		const params = flattenedFunc.get('params');
		if (params.length < 3) throw new Error('Unexpected parameters');

		const paramIds: string[] = [];
		for (const param of params) {
			if (!param.isIdentifier()) {
				if (param.isAssignmentPattern()) {
					continue;
				}
				throw new Error('Unexpected parameter type');
			}

			paramIds.push(param.node.name);
		}

		const scopeParam = params.find(p => p.isAssignmentPattern());
		if (!scopeParam) throw new Error('No scope pattern found');
		const scopePattern = extractScopePattern(scopeParam);
		if (!scopePattern) throw new Error('No scope pattern found');
		[this.scopeBinding, this.mainScopeName] = scopePattern;

		const whileStmt = asSingleStatement(flattenedFunc.get('body'));
		if (!whileStmt?.isWhileStatement()) throw new Error('Unexpected Function body');
		const withStmt = asSingleStatement(whileStmt.get('body'));
		if (!withStmt?.isWithStatement()) throw new Error('Unexpected WhileStatement body');

		let switchStmt = asSingleStatement(withStmt.get('body'));
		if (switchStmt?.isLabeledStatement()) {
			this.switchLabel = switchStmt.node.label.name;
			switchStmt = switchStmt.get('body');
		}
		if (!switchStmt?.isSwitchStatement()) throw new Error('Unexpected WithStatement body');
		this.switchStmt = switchStmt;

		const cfgState = extractState(whileStmt.get('test'));
		if (!cfgState) throw new Error('Unable to extract state information');
		const [extractedStateParams, stopState] = cfgState;
		if (![...extractedStateParams].every(id => paramIds.includes(id))) throw new Error('Unexpected state value');
		this.stateParams = paramIds.filter(p => extractedStateParams.has(p));
		this.stopState = stopState;

		// TODO: what if multiple
		const argsParam = params.find(p => p.isIdentifier() && !this.stateParams.includes(p.node.name));
		if (argsParam) {
			if (!argsParam.isIdentifier()) throw new Error('Unexpected final parameter');
			this.argsParam = argsParam.node.name;
		}

		const optionalWithScopeKey = extractWithScope(withStmt.get('object'), this.scopeBinding.identifier.name);
		if (!optionalWithScopeKey) throw new Error('Unexpected WithStatement scope');
		this.optionalWithScopeKey = optionalWithScopeKey;

		this.#extractBlocks();
	}

	#extractBlocks(path: NodePath<t.SwitchStatement> = this.switchStmt) {
		const cases: ExtractedCase[] = [];
		let currentTests: BlockTest[] = [];
		for (const switchCase of path.get('cases')) {
			const caseTest = switchCase.get('test');
			let test: BlockTest;
			if (!caseTest.hasNode()) {
				test = null;
			} else {
				test = caseTest;

				const complex = extractComplexTest.call(this, caseTest);
				if (complex) {
					test = complex;
				} else if (caseTest.isBinaryExpression({ operator: '+' })) {
					test = extractScopeTest.call(this, caseTest) ?? caseTest;
				} else {
					const evalState = caseTest.evaluate();
					if (evalState.confident) {
						const testValue = evalState.value;
						if (typeof testValue === 'number') {
							test = testValue;
						}
					}
				}
			}
			currentTests.push(test);

			if (switchCase.node.consequent.length === 0) continue;
			cases.push([currentTests, switchCase]);
			currentTests = [];
		}

		this.cases = cases;
		for (let i = 0; i < this.cases.length; i++) {
			this.caseOrder.set(this.cases[i][1], i);
		}
	}
}
