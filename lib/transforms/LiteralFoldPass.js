import estraverse from 'estraverse';
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
				let script = escodegen.generate(node);
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
			}
		}
	});
};
