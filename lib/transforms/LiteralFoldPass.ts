import * as t from '@babel/types';
import { type NodePath } from '@babel/traverse';

export const repeatUntilStable = true;

function isPureExpression(path: NodePath<t.Expression>): boolean {
	if (path.isLiteral()) {
		// Base case
		return true;
	} else if (path.isArrayExpression()) {
		for (const element of path.get('elements')) {
			if (element === null) continue;
			if (!element.isExpression()) {
				return false;
			}
			if (!isPureExpression(element)) {
				return false;
			}
		}

		return true;
	} else if (path.isObjectExpression()) {
		for (const property of path.get('properties')) {
			if (!property.isObjectProperty()) {
				return false;
			}
			if (property.node.computed) {
				const key = property.get('key');
				if (!key.isExpression()) {
					return false;
				} else if (!isPureExpression(key)) {
					return false;
				}
			}

			const value = property.get('value');
			if (!value.isExpression()) {
				return false;
			}
			if (isPureExpression(value)) {
				return false;
			}
		}

		return true;
	} else if (path.isUnaryExpression() && path.node.prefix) {
		switch (path.node.operator) {
		case '-':
		case '+':
		case '!':
		case '~':
		case 'void':
		case 'typeof':
			return isPureExpression(path.get('argument'));
		default:
			return false;
		}
	} else if (path.isBinaryExpression()) {
		const left = path.get('left');
		const right = path.get('right');
		if (!left.isExpression()) {
			return false;
		}
		return isPureExpression(left) && isPureExpression(right);
	} else if (path.isLogicalExpression()) {
		return (
			isPureExpression(path.get('left')) &&
			isPureExpression(path.get('right'))
		);
	} else if (path.isSequenceExpression()) {
		return path.get('expressions').every(isPureExpression);
	}
	return false;
}

export default (path: NodePath): boolean => {
	const evaluatable: NodePath[] = [];
	path.traverse({
		Expression(path) {
			if (path.isLiteral()) return;
			if (path.isObjectExpression()) return;
			if (path.isArrayExpression()) return;
			if (
				path.isUnaryExpression() &&
				['-', 'void'].includes(path.node.operator) &&
				path.get('argument').isNumericLiteral()
			)
				return;
			if (
				path.isBinaryExpression({ operator: '/' }) &&
				path.get('left').isNumericLiteral({ value: 1 }) && 
				path.get('right').isNumericLiteral({ value: 0 })
			)
				return;

			if (isPureExpression(path)) {
				evaluatable.push(path);
				path.skip();
			}
		},
	});

	let changed = false;
	for (const path of evaluatable) {
		const state = path.evaluate();
		if (state.confident) {
			path.replaceWith(t.valueToNode(state.value));
			changed = true;
		}
	}

	return changed;
};
