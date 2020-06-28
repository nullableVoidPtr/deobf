import estraverse from 'estraverse';
import utils from '../utils.js';

export const repeatUntilStable = true;

export default (tree) => {
	let removed = false;
	estraverse.replace(tree, {
		enter: (node) => {
			if (utils.specMatch(node, utils.parseStatement('(function(){}())')) &&
				node.expression.callee.body.body.length === 0) {
				removed = true;
				return estraverse.VisitorOption.Remove;
			}
		}
	});
	return removed;
}
