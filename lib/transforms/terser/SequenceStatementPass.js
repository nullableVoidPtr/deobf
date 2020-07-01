import estraverse from 'estraverse';
import utils from '../../utils.js';

const NodeToExpressionMap = {
	'ExpressionStatement': 'expression',
	'IfStatement': 'test',
	'SwitchStatement': 'discriminant',
};

export default (tree) => {
	let replaced = false;
	estraverse.traverse(tree, {
		enter(scope) {
			utils.modifyScope(scope,
				(statement, index, body) => {
					let expressions = statement[NodeToExpressionMap[statement.type]].expressions;
					statement[NodeToExpressionMap[statement.type]] = expressions.shift();
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
