import estraverse from 'estraverse';
import utils from '../../utils.js';

export default (tree) => {
	let stringFolded = false;
	estraverse.replace(tree, {
		leave(expression) {
			if (utils.specMatch(expression, utils.parseExpression('$_Literal_ + $_Literal_'))) {
				stringFolded = true;
				return {
					type: 'Literal',
					value:  expression.left.value + expression.right.value,
				};
			}
		}
	});
	return stringFolded;
}
