import estraverse from 'estraverse';
import { generate } from 'astring';
import escodegen from 'escodegen';
import vm from 'vm';

function isPureExpression(node) {
	if (node.type === 'Literal') { // Base case
		return true;
	} else if (node.type === 'ArrayExpression') {
		return node.elements.every(element => element === null ||
			isPureExpression(element));
	} else if (node.type === 'ObjectExpression') {
		return node.properties.every(property => property.kind === 'init' && isPureExpression(property.value));
	} else if (node.type === 'MemberExpression'){
		return isPureExpression(node.object) && (!node.computed || isPureExpression(node.property));
	} else if (node.type === 'UnaryExpression' && node.prefix) {
		switch (node.operator) {
			case '-':
			case '+':
			case '!':
			case '~':
			case 'typeof':
				return isPureExpression(node.argument);
		}
	} else if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) {
		return isPureExpression(node.left) && isPureExpression(node.right);
	}
	return false;
}

export default tree => {
	estraverse.replace(tree, {
		enter(node) {
			if (!['Literal', 'ObjectExpression', 'ArrayExpression'].includes(node.type) && isPureExpression(node)) {
				let script = generate(node);
				let result = {
					type: 'Literal',
					value: (new vm.Script(script)).runInNewContext({}),
				};
				if (['string', 'boolean', 'number'].includes(typeof result.value)) {
					if (result.value < 0) {
						result.value = -result.value;
						result = {
							type: 'UnaryExpression',
							operator: '-',
							prefix: true,
							argument: result,
						};
					}
					return result;
				}
			} else if (node.type == 'Literal' && node.raw && node.raw.includes('\\x')) {
				// XXX: This is absolutely cursed, but astring does not unescape strings,
				// and uses raw as the ground truth.
				node.raw = escodegen.generate(node);
			}
		}
	});
};
