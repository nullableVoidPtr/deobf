import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';
import { asSingleStatement, getParentingCall, pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	path.traverse({
		FunctionDeclaration(calcFunc) {
			const params = calcFunc.get('params');
			if (params.length < 3) return;

			const controlParam = params[0];
			if (!controlParam.isIdentifier()) return;
			const leftParam = params[1];
			if (!leftParam.isIdentifier()) return;
			const rightParam = params[2];
			if (!rightParam.isIdentifier()) return;

			const switchStmt = asSingleStatement(calcFunc.get('body'));
			if (!switchStmt?.isSwitchStatement()) return;
			if (!switchStmt.get('discriminant').isIdentifier({ name: controlParam.node.name })) return;

			const calcBinding = pathAsBinding(calcFunc);
			if (!calcBinding) return;

			const binaryMapping = new Map<string, t.BinaryExpression['operator']>()
			for (const switchCase of switchStmt.get('cases')) {
				const discriminant = switchCase.get('test');
				if (!discriminant.isStringLiteral()) return;

				const last = switchCase.get('consequent').at(-1);
				if (!last?.isReturnStatement()) return;

				const expr = last.get('argument');
				if (expr.isBinaryExpression()) {
					binaryMapping.set(discriminant.node.value, expr.node.operator);
				} else {
					return;
				}
			}

			function inlineExpr(ref: NodePath) {
				const call = getParentingCall(ref);
				if (!call) return false;

				const args = call.get('arguments');
				if (args.length < 3) return false;

				const [control, left, right] = args;
				if (!control.isStringLiteral()) return false;
				if (!left.isExpression()) return false;
				if (!right.isExpression()) return false;

				const operator = binaryMapping.get(control.node.value);
				if (!operator) return false;

				call.replaceWith(t.binaryExpression(operator, left.node, right.node));
				changed = true;
				return true;
			}

			let missed = false;
			for (const ref of calcBinding.referencePaths) {
				missed = !inlineExpr(ref) || missed;
			}

			if (!missed) {
				calcFunc.remove();
				changed = true;
			}
		}
	});

	return changed;
};