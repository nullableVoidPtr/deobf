import estraverse from 'estraverse';
import * as utils from '../../utils.js';

const NodeToExpressionMap = {
	'ExpressionStatement': 'expression',
	'IfStatement': 'test',
	'SwitchStatement': 'discriminant',
	'ReturnStatement': 'argument',
};

export default (tree) => {
	let replaced = false;
	estraverse.traverse(tree, {
		enter(scope) {
			utils.modifyScope(scope,
				(statement, index, body) => {
					let expressions = statement[NodeToExpressionMap[statement.type]].expressions;
					statement[NodeToExpressionMap[statement.type]] = expressions.pop();
					body.splice(index, 0, ...expressions.map(expression => ({
						type: 'ExpressionStatement',
						expression,
					})));
					replaced = true;
				},
				statement => statement[NodeToExpressionMap[statement.type]]?.type === 'SequenceExpression');
		}
	});
	return replaced;
};
