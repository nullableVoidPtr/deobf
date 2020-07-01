import estraverse from 'estraverse';
import utils from '../../utils.js';

export default tree => {
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
				let value;
				switch (node.operator) {
					case '+':
						value = left + right;
						break;
					case '-':
						value = left - right;
						break;
					case '^':
						value = left ^ right;
						break;
					case '%':
						value = left % right;
						break;
					case '&':
						value = left & right;
						break;
				}
				return {
					type: 'Literal',
					value,
				};
			}
		}
	});
};
