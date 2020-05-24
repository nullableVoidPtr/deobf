const esprima = require('esprima');
const estraverse = require('estraverse');

function parseStatement(string) {
	return estraverse.replace(esprima.parse(string).body[0], {
		enter(node) {
			if (node.type === 'Literal' && 'raw' in node) {
				delete node.raw;
				return;
			}
			if (node.type === 'VariableDeclarator' && node.id.name === '$VARDECL') {
				delete node.id;
				return;
			}
			if (node.type === 'Identifier' && node.name.startsWith('$')) {
				if (node.name.startsWith('$$')) {
					node.name = node.name.substring(1);
					return;
				}
				if (node.name.startsWith('$_') && node.name.endsWith('_')) {
					return {
						type: node.name.substr(2, node.name.length - 3)
					}
				}
				throw `Unescaped marker identifier ${node.name}`
			}
		},
	});
}

module.exports = {
	removeEmptyVarDecls(tree) {
		estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'VariableDeclaration' &&
					node.declarations.length === 0) {
					return estraverse.VisitorOption.Remove;
				}
			}
		});
	},
	escapeIdentifier(identifier) {
		if (identifier.startsWith('$')) {
			return '$' + identifier;
		}
		return identifier;
	},
	parseStatement: parseStatement,
	parseExpression(string) {
		return parseStatement(string).expression;
	},
	specMatch: function specMatch(node, spec) {
		return Object.entries(spec).every(([key, value]) => {
			if (!(key in node)) {
				return false;
			}
			if (value instanceof Object &&
				node[key] instanceof Object) {
				return specMatch(node[key], value);
			}
			return value === node[key];
		})
	},
	isValidIdentifier(identifier) {
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
		const validVarNameRegex = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;

		return reservedKeywords.indexOf(identifier) !== 1 &&
			validVarNameRegex.test(identifier);
	}
}
