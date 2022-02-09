import estraverse from 'estraverse';
import { generate } from 'astring';
import * as utils from '../../utils.js';

export default (tree, options) => {
	estraverse.replace(tree, {
		leave(node) {
			let results;
			if (results = utils.specMatch(node, utils.parseExpression('window.String.fromCharCode($_Literal$1_)'))) {
				return {
					type: 'Literal',
					value: String.fromCharCode(results[1].value),
				}
			} 
		}
	});
};

