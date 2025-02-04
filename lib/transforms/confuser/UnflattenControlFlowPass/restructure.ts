import * as t from '@babel/types';
import { Visitor, type NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import { MultiDirectedGraph } from 'graphology';
import { asSingleStatement, getPropertyName, isUndefined, pathAsBinding } from '../../../utils.js';
import ControlFlowGraph, { CFGAttributes, Edge, NormalizedBlock, reduceSimple } from '../../../control-flow/mod.js';
import { FlatControlFlow } from './controlFlow.js';
import FixParametersPass from '../FixParametersPass.js';

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (_traverse as any).default;

interface SuccessorInfo {
	switchCase: NodePath<t.SwitchCase>;
	stateValues: Record<string, number>;
	scopePredicates: Record<string, object>;
	withScope: NodePath | null;
	visibleScopes: Set<string>;
	declaredFuncs: Set<string>;
}

function matchBlock(controlFlow: FlatControlFlow, states: Record<string, number>, scopeValues: object) {
	const sum = Object.values(states).reduce((a, b) => a + b);
	let defaultCase: NodePath<t.SwitchCase> | null = null;
	for (const [tests, switchCase] of controlFlow.cases) {
		for (const test of tests) {
			if (typeof test === 'number') {
				if (sum === test) {
					return switchCase;
				}

				continue;
			} else if (test === null) {
				defaultCase = switchCase;
				continue;
			} else if ('stateId' in test) {
				const stateValue = states[test.stateId];
				if (stateValue == undefined) throw new Error();

				if (!test.notEqual.every(([stateParam, n]) => states[stateParam] !== n)) continue;
				if (sum === stateValue - test.offset) {
					return switchCase;
				}
			} else if ('object' in test) {
				let object = scopeValues;
				for (const key of test.object) {
					if (typeof object !== 'object') continue;
					object = (<Record<string, object>>object)[key];
					if (!object) continue;
				}

				if (typeof object !== 'object') continue;
				const value = (<Record<string, number>>object)[test.property];
				if (typeof value !== 'number') continue;

				if (sum === value + test.offset) {
					return switchCase;
				}
			}
		}
	}

	return defaultCase;
}

interface GotoInfo {
	stateDeltas: Record<string, number>;
	newWithScope: NodePath | null;
}

function isStatePredicate(controlFlow: FlatControlFlow, path: NodePath<t.Expression>): boolean {
	if (path.isNumericLiteral()) {
		return true;
	}

	if (path.isIdentifier()) {
		return controlFlow.stateParams.includes(path.node.name);
	}

	if (path.isUnaryExpression()) {
		if (!(['!', '+', '-'].includes(path.node.operator))) return false;
		return isStatePredicate(controlFlow, path.get('argument'));
	}

	if (path.isBinaryExpression()) {
		const left = path.get('left');
		const right = path.get('right');
		if (!left.isExpression()) return false;

		return isStatePredicate(controlFlow, left) && isStatePredicate(controlFlow, right);
	}

	return false;
}

class LiftedBlock {
	controlFlow: FlatControlFlow;
	stateValues: Record<string, number>;
	scopePredicates: Record<string, object>;

	syntheticCase!: NodePath<t.SwitchCase>;
	scopePredicateDeltas: Record<string, object> = {};
	visibleScopes: Set<string> = new Set();
	declaredFuncs: Set<string> = new Set();
	gotos: Map<NodePath<t.BreakStatement>, GotoInfo> = new Map();
	test: t.Expression | null = null;
	consequent!: SuccessorInfo | null;
	alternate: SuccessorInfo | null | undefined;

	constructor(
		controlFlow: FlatControlFlow,
		switchCase: NodePath<t.SwitchCase>,
		stateValues: Record<string, number>,
		scopePredicates: Record<string, object>,
		visibleScopes: Iterable<string>,
		declaredFuncs: Iterable<string>,
	) {
		this.controlFlow = controlFlow;
		this.stateValues = stateValues;
		this.scopePredicates = scopePredicates;

		this.visibleScopes = new Set(visibleScopes);
		this.visibleScopes.add(this.controlFlow.mainScopeName);
		this.declaredFuncs = new Set(declaredFuncs);

		const consequent = switchCase.get('consequent');
		if (consequent.length === 0) throw new Error();

		let syntheticStmt: t.Statement = t.switchStatement(
			t.cloneNode(controlFlow.switchStmt.node.discriminant, true),
			[t.cloneNode(switchCase.node, true)],
		);

		if (controlFlow.switchLabel) {
			syntheticStmt = t.labeledStatement(
				t.identifier(controlFlow.switchLabel),
				syntheticStmt,
			);
		}

		traverse(t.file(t.program([
			syntheticStmt
		])), {
			SwitchCase(syntheticCase) {
				this.syntheticCase = syntheticCase;
				syntheticCase.stop();
			},
		} , undefined, this);

		if (!this.syntheticCase) throw new Error();
		const syntheticConseqeuent = this.syntheticCase.get('consequent');
		if (syntheticConseqeuent.length === 0) throw new Error();

		this.liftGoto();

		this.liftPrologue();
		this.liftEpilogue();

		this.fixStatements();

		if (this.consequent === undefined) throw new Error();
	}

	liftGoto() {
		this.syntheticCase.traverse({
			Loop(path) {
				path.skip();
			},
			SwitchStatement(path) {
				path.skip();
			},
			BreakStatement(breakStmt) {
				if (this.controlFlow.switchLabel && breakStmt.node.label && breakStmt.node.label.name !== this.controlFlow.switchLabel) {
					throw new Error();
				}

				const goto: GotoInfo = {
					stateDeltas: {},
					newWithScope: null,
				};
				for (const stateId of this.controlFlow.stateParams) {
					goto.stateDeltas[stateId] = 0;
				}
				this.gotos.set(breakStmt, goto);

				let current = breakStmt.getPrevSibling();
				while (current.isExpressionStatement()) {
					const expr = current.get('expression');
					const next = current.getPrevSibling();

					let exprs = [expr];
					if (expr.isSequenceExpression()) {
						exprs = expr.get('expressions');
					}

					while (exprs.length > 0) {
						const expr = exprs.at(-1)!;
						if (expr.isUpdateExpression({ operator: '++' })) {
							const stateVar = expr.get('argument');
							if (!stateVar.isIdentifier() || !this.controlFlow.stateParams.includes(stateVar.node.name)) break;

							goto.stateDeltas[stateVar.node.name] += 1;
						} else if (expr.isAssignmentExpression({ operator: '+=' })) {
							const stateVar = expr.get('left');
							if (!stateVar.isIdentifier() || !this.controlFlow.stateParams.includes(stateVar.node.name)) break;

							const deltaPath = expr.get('right');
							const evaluation = deltaPath.evaluate();
							if (!evaluation.confident) break;
							const deltaValue = evaluation.value;
							if (typeof deltaValue !== 'number') break;
							
							goto.stateDeltas[stateVar.node.name] += deltaValue;
						} else if (expr.isAssignmentExpression({ operator: '=' })) {
							if (!expr.get('left').matchesPattern(
								`${this.controlFlow.scopeBinding.identifier.name}.${this.controlFlow.optionalWithScopeKey}`
							)) break;
							if (!goto.newWithScope) {
								goto.newWithScope = expr.get('right');
							}
						} else {
							break;
						}

						exprs.pop();
						expr.remove();
					}

					if (exprs.length > 0) {
						break;
					}
					if (!current.removed) {
						current.remove();
					}

					current = next;
				}
			},
		}, this);
	}

	liftPrologue() {
		this.syntheticCase.traverse({
			AssignmentExpression(assign) {
				if (assign.node.operator !== '=') return;

				const left = assign.get('left');
				const right = assign.get('right');
				if (left.isArrayPattern()) {
					const evaluation = right.evaluate();
					if (!evaluation.confident) return;
					const values = evaluation.value;
					if (!Array.isArray(values)) return;
					if (!values.every(e => typeof e === 'number')) return;

					const map: Record<string, number> = {}
					const elements = left.get('elements');
					for (let j = 0; j < elements.length; j++) {
						const lval = elements[j];
						if (!lval.isMemberExpression()) return;
						if (!lval.get('object').matchesPattern(`${this.controlFlow.scopeBinding.identifier.name}.${this.controlFlow.mainScopeName}`)) return;
						const key = getPropertyName(lval);
						if (key === null) return;

						map[key] = values[j];
					}

					this.scopePredicateDeltas = {
						[this.controlFlow.scopeBinding.identifier.name]: {
							[this.controlFlow.mainScopeName]: map,
						},
					};

					assign.remove();
				} else if (left.isMemberExpression()) {
					if (left.get('object').matchesPattern(`${this.controlFlow.scopeBinding.identifier.name}.${this.controlFlow.mainScopeName}`)) {
						const key = getPropertyName(left);
						if (key === null) return;

						const evaluation = right.evaluate();
						if (!evaluation.confident) return;
						const value = evaluation.value;
						if (typeof value !== 'number') return;

						this.scopePredicateDeltas = {
							[this.controlFlow.scopeBinding.identifier.name]: {
								[this.controlFlow.mainScopeName]: {
									[key]: value
								},
							},
						};

						assign.remove();
						return;
					}
					// TODO: root cause this quirk
					if (!left.get('object').isIdentifier({ name: this.controlFlow.scopeBinding.identifier.name })) return;
					if (!right.isObjectExpression()) return;
					if (right.node.properties.length !== 0) return;
					
					const scopeKey = getPropertyName(left);
					if (!scopeKey) return;

					this.visibleScopes.add(scopeKey);
					assign.remove();
				}
			},
		}, this);
	}

	evaluateStatePredicate(path: NodePath<t.Expression>, stateValues = this.stateValues): boolean | null {
		if (!isStatePredicate(this.controlFlow, path)) return null;

		const expr = t.cloneNode(path.node, true);

		const state: {
			result: boolean | null;
		} = { result: null };
		traverse(t.file(t.program([t.expressionStatement(expr)])), {
			ReferencedIdentifier(path) {
				const value = stateValues[path.node.name];
				if (value === undefined) throw new Error();

				path.replaceWith(t.valueToNode(value));
			},
			ExpressionStatement: {
				exit(path) {
					const test = path.get('expression');
					this.result = test.evaluateTruthy() ?? null;
				}
			}
		}, undefined, state);

		return state.result;
	}

	liftEpilogue() {
		let branch = this.syntheticCase.get('consequent').at(-1);

		let statePredicate: NodePath<t.Expression> | null = null;
		if (branch?.isIfStatement()) {
			const alternate = branch.get('alternate');

			const test = branch.get('test');
			if (!alternate.hasNode()) {
				if (!isStatePredicate(this.controlFlow, test)) throw new Error();
				statePredicate = test;
				if (this.evaluateStatePredicate(statePredicate) !== false) throw new Error();

				const toRemove = branch;
				branch = branch.getPrevSibling() as NodePath<t.Statement>;
				toRemove.remove();
			}
		}

		const reifySuccessor = (jump: GotoInfo): SuccessorInfo | null => {
			const newStateValues: Record<string, number> = {};
			for (const stateId of this.controlFlow.stateParams) {
				newStateValues[stateId] = this.stateValues[stateId] + (jump.stateDeltas[stateId] ?? 0);
			}

			const sum = Object.values(newStateValues).reduce((a, b) => a + b);
			if (sum === this.controlFlow.stopState) return null;

			const successorCase = matchBlock(
				this.controlFlow,
				newStateValues,
				{
					...this.scopePredicates,
					...this.scopePredicateDeltas,
				},
			);
			if (!successorCase) throw new Error();

			return {
				switchCase: successorCase,
				stateValues: newStateValues,
				scopePredicates: { ...this.scopePredicates, ...this.scopePredicateDeltas },
				withScope: jump.newWithScope,
				visibleScopes: this.visibleScopes,
				declaredFuncs: this.declaredFuncs,
			};
		}

		if (branch?.isReturnStatement() || branch?.isThrowStatement()) {
			this.consequent = null;
			return;
		}

		const preEpilogue = branch?.getPrevSibling();
		if (preEpilogue?.isReturnStatement() || branch?.isThrowStatement() ) {
			this.consequent = null;
			this.alternate = undefined;
			branch!.remove();
			return;
		}

		if (branch?.isIfStatement()) {
			// Compare condition against incoming state
			// After continuing with epilogue analysis, compare condition against outgoing state
			const consequent = branch.get('consequent');
			const alternate = branch.get('alternate');

			if (!consequent.isBlockStatement() || consequent.node.body.length === 0) throw new Error();
			if (!alternate.isBlockStatement() || alternate.node.body.length === 0) throw new Error();
			
			const statements = branch.getAllPrevSiblings();
			if (!statements.every(p => p.isStatement())) throw new Error();

			this.test = branch.get('test').node;

			const consequentBreak = asSingleStatement(consequent);
			const alternateBreak = asSingleStatement(alternate);

			if (!consequentBreak?.isBreakStatement() || !alternateBreak?.isBreakStatement()) throw new Error();

			const consequentGoto = this.gotos.get(consequentBreak);
			const alternateGoto = this.gotos.get(alternateBreak);

			if (!consequentGoto || !alternateGoto) throw new Error();

			this.consequent = reifySuccessor(consequentGoto);
			this.alternate = reifySuccessor(alternateGoto);
		} else if (branch?.isBreakStatement()) {
			const consequentGoto = this.gotos.get(branch);
			if (!consequentGoto) throw new Error();
			this.consequent = reifySuccessor(consequentGoto);
		} else {
			throw new Error();
		}

		branch.remove();
	}

	fixStatements() {
		const identifierVisitor: Visitor<this> = {
			ReferencedIdentifier(stateId) {
				if (!stateId.isIdentifier()) return;
				if (stateId.node.name === this.controlFlow.argsParam) {
					if (pathAsBinding(stateId)) return;
					stateId.replaceWith(t.identifier('arguments'));
				} else if (stateId.node.name in this.stateValues) {
					if (pathAsBinding(stateId)) return;
					stateId.replaceWith(t.numericLiteral(this.stateValues[stateId.node.name]))
				}
			},
			MemberExpression: {
				exit(memberExpr) {
					const object = memberExpr.get('object');
					let scopeName: string;
					if (object.isMemberExpression()) {
						const innerObject = object.get('object');
						if (!innerObject.isIdentifier({ name: this.controlFlow.scopeBinding.identifier.name })) return;
						const scopeKey = getPropertyName(object);
						if (!scopeKey || !this.visibleScopes.has(scopeKey)) return;
						scopeName = scopeKey;
					} else if (object.isIdentifier() && this.visibleScopes.has(object.node.name)) {
						scopeName = object.node.name
					} else {
						return;
					}

					const property = getPropertyName(memberExpr);
					if (property === null || !t.isValidIdentifier(property)) return;

					const [reference] = memberExpr.replaceWith(t.identifier(property));
					reference.setData('isLiftedVariable', true);

					if (memberExpr.getFunctionParent() === null) {
						let scopeDeclarations = this.controlFlow.scopeDeclarations[scopeName];
						if (!scopeDeclarations) {
							scopeDeclarations = this.controlFlow.scopeDeclarations[scopeName] = new Set();
						}

						if (!scopeDeclarations.has(property)) {
							reference.setData('isDeclaration', true);
						}

						scopeDeclarations.add(property);
					}
				},
			},
			SequenceExpression: {
				exit(path) {
					const call = path.parentPath;
					if (!call?.isCallExpression()) return;

					const exprs = path.get('expressions');
					const callee = exprs.pop();
					if (!callee?.getData('isLiftedVariable', false)) {
						if (!callee?.isIdentifier() || !this.declaredFuncs.has(callee.node.name)) return;
					}
					if (!exprs.every(e => e.isPure())) return;

					path.replaceWith(callee);
				},
			},
		};

		this.syntheticCase.traverse(identifierVisitor, this);
		if (this.test) {
			const wrappedExpr = t.expressionStatement(this.test);
			traverse(t.file(t.program([wrappedExpr])), identifierVisitor, undefined, this);
			this.test = wrappedExpr.expression;
		}

		this.syntheticCase.traverse({
			AssignmentExpression(assign) {
				if (assign.node.operator !== '=') return;
				if (!assign.isAssignmentExpression({ operator: '=' })) return;

				const path = assign.parentPath;

				const left = assign.get('left');
				if (left.isArrayPattern()) {
					const state = { allDeclarations: true };
					left.traverse({
						AssignmentPattern(path) {
							path.get('right').skip();
						},
						ReferencedIdentifier(path) {
							if (path.getAncestry().some(p => p.parentPath?.isAssignmentPattern() && p.key === 'right')) return;
							if (path.getData('isDeclaration', false)) return;

							state.allDeclarations = false;
							path.stop();
						}
					}, state)

					if (state.allDeclarations) {
						const init = assign.get('right');
						const decn = t.variableDeclaration(
							'var',
							[t.variableDeclarator(
								left.node,
								init.node,
							)],
						);
						if (path.isExpressionStatement()) {
							const [newDecn] = path.replaceWith(decn);
							newDecn.setData('isLiftedVariable', true);
						} else if (path.isForStatement() && assign.key === 'init') {
							const [newDecn] = assign.replaceWith(decn);
							newDecn.setData('isLiftedVariable', true);
						}
					}

					return;
				}
				if (!left.isIdentifier() || !left.getData('isLiftedVariable', false)) return;

				const init = assign.get('right');
				if (init.isFunctionExpression() && path.isExpressionStatement()) {
					const funcId = init.get('id');
					if (funcId.hasNode()) {
						const binding = pathAsBinding(funcId)
						if (binding?.referenced) {
							if (!binding.constant) return;
							if (binding.path !== init) return;

							// TODO: analyse
							for (const ref of binding.referencePaths) {
								ref.replaceWith(t.identifier(left.node.name));
							}
						}
					}

					path.replaceWith(t.functionDeclaration(
						left.node,
						init.node.params,
						init.node.body,
						init.node.generator,
						init.node.async,
					));
					this.declaredFuncs.add(left.node.name);
				} else if (left.getData('isDeclaration', false)) {
					const decn = t.variableDeclaration('var', [
						t.variableDeclarator(
							left.node,
							init.node,
						),
					]);
					if (path.isExpressionStatement()) {
						const [newDecn] = path.replaceWith(decn);
						newDecn.setData('isLiftedVariable', true);
					} else if (path.isForStatement() && assign.key == 'init') {
						const [newDecn] = assign.replaceWith(decn);
						newDecn.setData('isLiftedVariable', true);
					}
				}
			},
			SequenceExpression(path) {
				const call = path.parentPath;
				if (!call?.isCallExpression()) return;

				const exprs = path.get('expressions');
				const callee = exprs.pop();
				if (!callee?.getData('isLiftedVariable', false)) {
					if (!callee?.isIdentifier() || !this.declaredFuncs.has(callee.node.name)) return;
				}
				if (!exprs.every(e => e.isPure())) return;

				path.replaceWith(callee);
			},
		}, this);
	}

	get cfgBlock(): NormalizedBlock {
		return {
			beforeStatements: this.syntheticCase.node.consequent,
			test: this.test ?? null,
		};
	}

	get successors(): (SuccessorInfo | null)[] {
		return [
			this.consequent,
			...(this.alternate ? [this.alternate] : []),
		];
	}
}

export function outlineCallAsFunc(
	controlFlow: FlatControlFlow,
	path: NodePath,
	{
		inlineTarget = null,
		insertBefore = null,
		idOverride = null,
		scopePredicates = null,
	}: {
		inlineTarget?: NodePath | null
		insertBefore?: NodePath | null,
		idOverride?: string | null,
		scopePredicates?: Record<string, object> | null,
	},
): {
	outlinedFunc: NodePath<t.FunctionDeclaration | t.FunctionExpression>;
	call?: NodePath<t.CallExpression> | null;
	functionScopePredicates: Record<string, object>;
} | null {
	if (!scopePredicates) {
		scopePredicates = {};
	}
	if (!insertBefore) {
		insertBefore = controlFlow.flattenedFunc;
	}
	if (!path.isCallExpression()) return null;
	const args = path.get('arguments');
	if (args.length < controlFlow.stateParams.length) return null;

	const initStateValues: Record<string, number> = {};
	for (let i = 0; i < controlFlow.stateParams.length; i++) {
		const arg = args[i];
		const stateId = controlFlow.stateParams[i];

		const evaluation = arg.evaluate();
		if (!evaluation.confident) return null;
		const stateValue = evaluation.value;
		if (typeof stateValue !== 'number') return null;

		initStateValues[stateId] = stateValue;
	}

	const cachedEntrypoint = controlFlow.entrypoints.find(([states, _]) => {
		for (let i = 0; i < states.length; i++) {
			if (initStateValues[controlFlow.stateParams[i]] !== states[i]) return false;
		}

		return true;
	});
	
	const [scopeObj = null, argArray = null] = args.slice(controlFlow.stateParams.length);
	const outlinedArgs = [];
	if (argArray) {
		if (!argArray.isExpression()) return null;
		outlinedArgs.push(t.spreadElement(argArray.node));
	}

	if (cachedEntrypoint) {
		const [funcBody, functionScopePredicates] = cachedEntrypoint[1];

		let target: NodePath<t.Expression> = path;
		if (controlFlow.flattenedFunc.node.generator) {
			const memberExpr = target.parentPath;
			if (memberExpr.isMemberExpression() && target.key === 'object' && getPropertyName(memberExpr) === 'next') {
				const nextCall = memberExpr.parentPath;
				if (nextCall.isCallExpression() && memberExpr.key === 'callee') {
					const value = nextCall.parentPath;
					if (value.isMemberExpression() && nextCall.key === 'object' && getPropertyName(memberExpr) === 'value') {
						target = value;
					}
				}
			}
		}


		const [call] = target.replaceWith(
			t.callExpression(
				t.functionExpression(
					undefined,
					[],
					t.blockStatement(
						funcBody
					),
					false,
					false,
				),
				outlinedArgs,
			)
		);

		const callee = call.get('callee');
		if (!callee.isFunctionExpression()) return null;

		return {
			outlinedFunc: callee,
			call,
			functionScopePredicates,
		};
	}

	const entryScopes = new Set<string>();
	const potentialFuncScopes = new Set<string>();
	if (scopeObj) {
		if (!scopeObj.isObjectExpression()) return null;
		for (const property of scopeObj.get('properties')) {
			if (!property.isObjectProperty()) return null;
			const scopeName = getPropertyName(property);
			if (scopeName === null) return null;
			entryScopes.add(scopeName)

			const value = property.get('value');
			if (scopeName === controlFlow.mainScopeName) {
				if (!value.matchesPattern(`${controlFlow.scopeBinding.identifier.name}.${controlFlow.mainScopeName}`)) return null;
				continue;
			}

			potentialFuncScopes.add(scopeName);

			if (value.isObjectExpression() && value.node.properties.length === 0) continue;

			if (!value.isMemberExpression()) return null;
			if (!value.get('object').isIdentifier({ name: controlFlow.scopeBinding.identifier.name })) return null;
			if (getPropertyName(value) !== scopeName) return null;
		}
	}

	const caseCFG = new MultiDirectedGraph<
		NormalizedBlock & {
			stateValues: Record<string, number>;
			withScope: string | null;
			funcScope: string | null;
		},
		Edge,
		CFGAttributes
	>();

	const entrySwitchCase = matchBlock(controlFlow, initStateValues, scopePredicates);
	if (!entrySwitchCase) throw new Error();

	let functionScopePredicates = scopePredicates;
	const queue: {
		predecessor: number | null,
		flowPredicate: boolean;
		successor: SuccessorInfo,
	}[] = [{
		predecessor: null,
		flowPredicate: true,
		successor: {
			switchCase: entrySwitchCase,
			stateValues: initStateValues,
			scopePredicates: functionScopePredicates,
			withScope: null,
			visibleScopes: entryScopes,
			declaredFuncs: new Set(),
		}
	}];
	let visitedEntry = false;
	const visitedCases = new Set<number>();
	while (queue.length > 0) {
		const {
			predecessor,
			flowPredicate,
			successor: {
				switchCase,
				scopePredicates,
				stateValues,
				withScope,
				visibleScopes,
				declaredFuncs,
			},
		} = queue.pop()!;
		if (!switchCase) return null;
		const caseId = controlFlow.caseOrder.get(switchCase);
		if (caseId == undefined) throw new Error();

		if (visitedCases.has(caseId)) {
			if (predecessor != null) {
				caseCFG.addDirectedEdge(predecessor, caseId, {
					flowPredicate,
				});
			} else if (!visitedEntry) {
				visitedEntry = true;
			} else {
				throw new Error();
			}

			continue;
		}

		let currentWithScope: string | null = null; 
		if (withScope) {
			if (!withScope?.isMemberExpression()) throw new Error();
			if (!withScope.get('object').isIdentifier({ name: controlFlow.scopeBinding.identifier.name })) throw new Error();
			currentWithScope = getPropertyName(withScope);
			if (currentWithScope === null) throw new Error();
		}

		const lifted = new LiftedBlock(controlFlow, switchCase, stateValues, scopePredicates, visibleScopes, declaredFuncs);
		const { successors } = lifted;
		const succeedingWithScopes = new Set(successors.flatMap((successor) => {
			if (successor === null) return [];
			const { withScope } = successor;
			if (!withScope?.isMemberExpression()) throw new Error();
			if (!withScope.get('object').isIdentifier({ name: controlFlow.scopeBinding.identifier.name })) throw new Error();
			const scopeKey = getPropertyName(withScope);
			if (scopeKey === null) throw new Error();

			return [scopeKey];
		}));

		let funcScope = null;
		if (!currentWithScope && potentialFuncScopes.size > 0) {
			if (succeedingWithScopes.size === 0) {
				if (switchCase !== entrySwitchCase) {
					if (potentialFuncScopes.size !== 1) throw new Error();
					funcScope = potentialFuncScopes.values().next().value!;
				}
			} else {
				if (succeedingWithScopes.size !== 1) throw new Error();
				funcScope = succeedingWithScopes.values().next().value!;
			}
		}

		caseCFG.addNode(caseId, {
			...lifted.cfgBlock,
			stateValues,
			withScope: currentWithScope,
			funcScope,
		});
		if (predecessor != null) {
			caseCFG.addDirectedEdge(predecessor, caseId, {
				flowPredicate,
			});
		} else if (!visitedEntry) {
			visitedEntry = true;
		} else {
			throw new Error();
		}

		if (successors.length > 2) throw new Error();
		if (successors.length === 0) {
			break;
		} else if (successors.length === 1) {
			const successor = successors[0];
			if (successor !== null) {
				functionScopePredicates = successor.scopePredicates;
				queue.push({
					predecessor: caseId,
					flowPredicate: true,
					successor,
				});
			} else {
				functionScopePredicates = {
					...lifted.scopePredicates,
					...lifted.scopePredicateDeltas,
				};
			}
		} else if (successors.length === 2) {
			const [consequent, alternate] = successors;
			if (consequent !== null) {
				functionScopePredicates = consequent.scopePredicates;
				queue.push({
					predecessor: caseId,
					flowPredicate: true,
					successor: consequent,
				});
			}
			if (alternate !== null) {
				if (consequent === null) {
					functionScopePredicates = alternate.scopePredicates;
				}
				queue.push({
					predecessor: caseId,
					flowPredicate: false,
					successor: alternate,
				});
			}
		} else {
			throw new Error();
		}

		visitedCases.add(caseId);
	}

	const funcCFG = new ControlFlowGraph(caseCFG);
	reduceSimple(funcCFG);
	void funcCFG;
	const funcBody: t.Statement[] = [];
	if (funcCFG.order === 1) {
		const [node] = funcCFG.nodes();
		funcBody.push(...funcCFG.getNodeAttribute(node, 'beforeStatements'))
	} else {
		throw new Error();
	}

	let target: NodePath<t.Expression> = path;
	if (controlFlow.flattenedFunc.node.generator) {
		const memberExpr = target.parentPath;
		if (memberExpr.isMemberExpression() && target.key === 'object' && getPropertyName(memberExpr) === 'next') {
			const nextCall = memberExpr.parentPath;
			if (nextCall.isCallExpression() && memberExpr.key === 'callee') {
				const value = nextCall.parentPath;
				if (value.isMemberExpression() && nextCall.key === 'object' && getPropertyName(value) === 'value') {
					target = value;
				}
			}
		}
	}

	let outlinedId;
	if (idOverride) {
		outlinedId = t.identifier(idOverride);
	} else {
		outlinedId = controlFlow.flattenedFunc.scope.parent.generateUidIdentifier(
			`${controlFlow.binding.identifier.name}_outlined_`
		);
	}


	let outlinedFunc: NodePath<t.FunctionDeclaration | t.FunctionExpression>;
	let call;
	if (inlineTarget?.isFunctionDeclaration() && inlineTarget.isAncestor(path)) {
		[outlinedFunc] = inlineTarget.replaceWith(
			t.functionDeclaration(
				inlineTarget.node.id,
				[],
				t.blockStatement(
					funcBody,
				),
				false,
				false,
			),
		);
	} else if (inlineTarget?.isFunctionExpression() && inlineTarget.isAncestor(path)) {
		[outlinedFunc] = inlineTarget.replaceWith(
			t.functionExpression(
				inlineTarget.node.id,
				[],
				t.blockStatement(
					funcBody,
				),
				false,
				false,
			),
		);
	} else if (inlineTarget === path) {
		[call] = target.replaceWith(
			t.callExpression(
				t.functionExpression(
					outlinedId,
					[],
					t.blockStatement(
						funcBody,
					),
					false,
					false,
				),
				outlinedArgs,
			),
		);
		
		const callee = call.get('callee');
		if (!callee.isFunctionExpression()) throw new Error();

		outlinedFunc = callee;
	} else {
		[outlinedFunc] = insertBefore.insertAfter(
			t.functionDeclaration(
				outlinedId,
				[],
				t.blockStatement(
					funcBody
				),
				false,
				false,
			),
		);

		[call] = target.replaceWith(
			t.callExpression(
				t.identifier(outlinedId.name),
				outlinedArgs,
			)
		);
	}

	const last = outlinedFunc.get('body').get('body').at(-1);
	if (last?.isReturnStatement()) {
		const argument = last.get('argument');
		if (!argument.hasNode() || isUndefined(argument)) {
			last.remove();
		}
	}

	FixParametersPass(outlinedFunc);

	controlFlow.entrypoints.push([
		controlFlow.stateParams.map(id => initStateValues[id]),
		[funcBody.map(s => t.cloneNode(s, true)), functionScopePredicates],
	]);

	return {
		outlinedFunc,
		call,
		functionScopePredicates,
	};
}