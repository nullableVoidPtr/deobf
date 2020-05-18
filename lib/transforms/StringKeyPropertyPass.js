const BasePass = require('./BasePass.js');
const estraverse = require('estraverse');
const utils = require('../utils.js')

const reservedKeywords = [
	'break', 'do', 'instanceof', 'typeof',
	'case', 'else', 'new', 'var',
	'catch', 'finally', 'return', 'void',
	'continue', 'for', 'switch', 'while',
	'debugger', 'if', 'throw', 'delete',
	'in', 'try', 'class', 'enum',
	'extends', 'super', 'const', 'export',
	'import', 'implements', 'let', 'private',
	'public', 'interface', 'package', 'protected',
	'static', 'yield', 'null', 'true',
	'false',
];
const validVarNameRegex = /[a-zA-Z_$][0-9a-zA-Z_$]/;

module.exports = class StringKeyPropertyPass extends BasePass {
	static _transform(tree) {
		let bracketReplaced = false;
		estraverse.replace(tree, {
			enter: (node) => {
				if (utils.specMatch(node, {
					type: 'MemberExpression',
					computed: true,
					property: {
						type: 'Literal',
					},
				}) &&
					node.property.value.length <= 20 &&
					reservedKeywords.indexOf(node.property.value) !== 1 &&
					validVarNameRegex.test(node.property.value)
				) {
					bracketReplaced = true;
					node.computed = false;
					node.property = {
						type: 'Identifier',
						name: node.property.value
					};
					return node;
				}
			}
		});
		return bracketReplaced;
	}
}
