import * as t from '@babel/types';
import * as bq from 'babylon-query';
import _traverse, { type Binding, type NodePath } from '@babel/traverse';
import { dereferencePathFromBinding } from '../../../utils.js';
import { DecoderInfo } from './decoder.js';

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (_traverse as any).default;

function isRotatePredicate(expression: NodePath<t.Expression>): boolean {
	if (expression.isLiteral()) {
		return true;
	}

	if (expression.isBinaryExpression()) {
		const left = expression.get('left');
		const right = expression.get('right');
		if (!left.isExpression() || !right.isExpression()) {
			return false;
		}

		return isRotatePredicate(left) && isRotatePredicate(right);
	}

	if (expression.isUnaryExpression()) {
		return isRotatePredicate(expression.get('argument'));
	}

	const parseIntSelector = bq.parse(
		`CallExpression[arguments.length=1]:root:has(
			> Identifier.callee[name='parseInt']
		):has(
			> CallExpression.arguments.0:has(
				> Identifier.callee
			)
		)`
	);
	const parseIntMatch = bq.matches(
		expression,
		parseIntSelector,
		{},
	);

	return parseIntMatch;
}

function evalRotatePredicate(node: t.Expression): number {
	const top = t.expressionStatement(t.cloneNode(node, true));
	traverse(top, {
		noScope: true,
		CallExpression(parseIntCallPath) {
			if (!parseIntCallPath.get('callee').isIdentifier({name: 'parseInt'})) return;

			const value = parseIntCallPath.node.extra?.['value'];
			if (typeof value != 'number') {
				throw new Error('missed calculation');
			}

			parseIntCallPath.replaceWith(t.numericLiteral(value));
		},
		exit(topExprPath) {
			if (topExprPath.parentPath) return;

			const state = topExprPath.evaluate();
			if (state.confident && typeof state.value == 'number') {
				topExprPath.replaceWith(t.numericLiteral(state.value));
				topExprPath.skip();
			} else {
				throw new Error('unexpected arg in call to decoder');
			}
		}
	});

	if (t.isNumericLiteral(top.expression)) {
		return top.expression.value;
	}

	return Number.NaN;
}

function fixSimpleRotator(rotatorIifePath: NodePath<t.CallExpression>, decoderInfo: DecoderInfo): boolean {
	const matches = bq.query(
		rotatorIifePath, 'WhileStatement > UpdateExpression.test > Identifier'
	);
	if (matches.length === 0) return false;

	const shiftArg = rotatorIifePath.get('arguments.1') as NodePath;
	if (!shiftArg?.isNumericLiteral()) return false;
	const shiftCount = shiftArg.node.value % decoderInfo.data.length;
	decoderInfo.data.push(...decoderInfo.data.splice(0, shiftCount));

	return true;
}

export default function analyseRotators(decoders: Map<Binding, DecoderInfo>) {
	for (const decoderInfo of decoders.values()) {
		const arrayBinding = decoderInfo.arrayBinding;
		const arrayArgRef = arrayBinding.referencePaths.find(
			p => p.listKey == 'arguments' && p.key == 0
		);
		if (!arrayArgRef) continue;

		const rotatorIifePath = arrayArgRef?.parentPath;
		if (!rotatorIifePath?.isCallExpression()) continue;

		const args = rotatorIifePath.get('arguments');
		if (args.length !== 2) continue;
		if (!args[1].isNumericLiteral()) continue;

		const expectedValueArg = args[1];
		const state: {
			rotatePredicate?: NodePath<t.Expression>;
		} = {};
		if (fixSimpleRotator(rotatorIifePath, decoderInfo)) {
			rotatorIifePath.remove();
			dereferencePathFromBinding(arrayBinding, arrayArgRef);
			continue;
		}

		rotatorIifePath.traverse({
			VariableDeclarator(varPath) {
				const init = varPath.get('init');
				if (!init.isExpression()) return;
				if (!isRotatePredicate(init)) return;

				this.rotatePredicate = init;
				varPath.stop();
			},
		}, state);

		const { rotatePredicate } = state;
		if (!rotatePredicate) {
			throw Error('Cannot find validator expression');
		}

		const curriedIntCalls = new Map<NodePath, (() => number)>();
		rotatePredicate.traverse({
			CallExpression(decoderCallPath) {
				const parseIntCallPath = decoderCallPath.parentPath;
				if (!parseIntCallPath.isCallExpression()) return;
				if (!parseIntCallPath.get('callee').isIdentifier({name: 'parseInt'})) return;

				const calleePath = decoderCallPath.get('callee');
				if (!calleePath.isIdentifier()) return;

				const decoderEntry = [...decoders.entries()].find(([b, _]) => b.referencePaths.includes(calleePath));
				if (!decoderEntry) return;

				const decoderFunc = decoderEntry[1].decoder;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const args: any[] = [];
				for (const literal of decoderCallPath.get('arguments')) {
					const state = literal.evaluate();
					if (state.confident) {
						args.push(state.value);
					} else {
						throw new Error('unexpected arg in call to decoder');
					}
				}
				const intFunc = (() => {
					try {
						return parseInt(decoderFunc(...args));
					} catch {
						return Number.NaN;
					}
				});

				this.curriedIntCalls.set(parseIntCallPath, intFunc);
			}
		}, { curriedIntCalls });
		if (curriedIntCalls.size === 0) {
			throw new Error('cannot find decoder calls in rotator predicate');
		}

		const sourceArray = decoderInfo.data.slice(0);
		const arrayLength = sourceArray.length
		for (let offset = 0; offset < arrayLength; offset++) {
			const array = sourceArray.slice(offset, arrayLength).concat(sourceArray.slice(0, offset));
			decoderInfo.data.splice(0, arrayLength, ...array);

			let found = true;
			for (const [parseIntPath, func] of curriedIntCalls) {
				try {
					const value = func()
					if (Number.isNaN(value)) {
						found = false;
						break;
					}

					if (!parseIntPath.node.extra) {
						parseIntPath.node.extra = {};
					}
					parseIntPath.node.extra['value'] = value;
				} catch {
					found = false;
					break;
				}
			}

			if (!found) {
				decoderInfo.data.splice(0, arrayLength, ...sourceArray);
				continue;
			}

			const expectedValue = expectedValueArg.node.value;
			if (evalRotatePredicate(rotatePredicate.node) !== expectedValue) {
				decoderInfo.data.splice(0, arrayLength, ...sourceArray);
				continue;
			}

			for (const [binding, _] of decoders) {
				for (const reference of binding.referencePaths) {
					if (!rotatorIifePath.isAncestor(reference)) continue;
					dereferencePathFromBinding(binding, reference);
				}
			}

			dereferencePathFromBinding(arrayBinding, arrayArgRef);
			rotatorIifePath.remove();
			break;
		}
	}
}
