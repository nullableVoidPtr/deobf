import estraverse from 'estraverse';
import utils from '../utils.js';
import BasePass from './BasePass.js'

export const repeatUntilStable = true;

export default class extends BasePass {
	static _transform(tree) {
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
}
