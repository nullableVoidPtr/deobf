import estraverse from 'estraverse';
import { generate } from 'astring';
import * as utils from '../../utils.js';

function analyseLoopArray(tree) {
	let arrayDetails = null;
	estraverse.traverse(tree, {
		enter(node) {
			let matches;
			if (matches = utils.specMatch(node, utils.parseStatement(`
				var $_Identifier$1_ = $_CallExpression$2_;
			`))) {
				let arrayName = matches[1].name;
				let arrayGenerator = matches[2].callee;
				let generatorsParams = matches[2].arguments;
				for (let argument of generatorsParams) {
					if (argument.type != 'Literal') {
						return estraverse.VisitorOption.Continue;
					}
				}

				arrayDetails = {
					identifier: arrayName,
					arrayNumber: generatorsParams[0].value,
					offset: generatorsParams[1].value,
				}

				return estraverse.VisitorOption.Break;
			}
		}
	});

	return arrayDetails;
}

const reverseIdx = (arrNum, offset) => (indices) => (indices.reduce((a, b) => {
	let d = b - a * offset;
	while (d < 0) {
		d += arrNum;
	}
	return d;
}) * offset) % arrNum


export default (tree, options) => {
	let results = analyseLoopArray(tree);
	if (results === null) {
		return false;
	}
	let resolver = reverseIdx(results.arrayNumber, results.offset);
	
	estraverse.replace(tree, {
		enter(node) {
			if (node.type == 'VariableDeclarator' &&
				node.id.name == results.identifier &&
				node.init.type == 'CallExpression') {
				return estraverse.VisitorOption.Remove;
			} 
			if (node.type == 'MemberExpression' &&
				['Identifier', 'MemberExpression'].includes(node.object.type) &&
				node.property.type == 'Literal' &&
				typeof node.property.value == 'number') {
				let indices = [node.property.value];
				let current = node;
				while (current.object.type != 'Identifier') {
					current = current.object;
					if (current.property.type != 'Literal' ||
						typeof current.property.value != 'number') {
						return;
					} else if (current.object == 'Identifier' &&
						current.object.name != results.identifier) {
						return;
					}

					indices.unshift(current.property.value);
				}
				return {
					type: 'Literal',
					value: resolver(indices),
				}
			}
		}
	});
	utils.removeEmptyVarDecls(tree);
};

