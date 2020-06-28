import estraverse from 'estraverse';
import utils from '../../utils.js';

export default (tree, options) => {
	estraverse.replace(tree, {
		leave(node) {
			if (utils.specMatch(node, {
				type: 'BinaryExpression',
				left: {
					type: 'Literal',
				},
				right: {
					type: 'Literal',
				},
			})) {
				let left = node.left.value;
				let right = node.right.value;
				let result;
				switch (node.operator) {
					case '+':
						result = left + right;
						break;
					case '-':
						result = left - right;
						break;
					case '^':
						result = left ^ right;
						break;
					case '%':
						result = left % right;
						break;
					case '&':
						result = left & right;
						break;
				}
				return {
					type: 'Literal',
					value: result,
				}
			}
		}
	});
}
