import estraverse from 'estraverse';
import { generate } from 'astring';
import * as utils from '../../utils.js';

function analyseStringArray(tree) {
	let arrayDetails = null;
	estraverse.traverse(tree, {
		enter(node) {
			let matches;
			if (matches = utils.specMatch(node, utils.parseStatement(`
				var $_Identifier$1_ = $_CallExpression$2_;
			`))) {
				let arrayName = matches[0].name;
				let arrayGenerator = matches[1].callee;
				let arrayParameters = [];
				for (let argument of matches[1].arguments) {
					if (argument.type != 'Literal') {
						return estraverse.VisitorOption.Continue;
					}
					arrayParameters.push(argument.value);
				}
				return estraverse.VisitorOption.Break;
			}
		}
	});
}

export default (tree, options) => {
	let results = analyseStringArray(tree, options.stringRotation);
};

