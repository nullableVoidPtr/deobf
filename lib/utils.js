const estraverse = require('estraverse')

module.exports = {
	removeEmptyVarDecls: (tree) => {
		estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'VariableDeclaration' &&
					node.declarations.length === 0) {
					return estraverse.VisitorOption.Remove;
				}
			}
		});
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
	isValidIdentifier: (identifier) => {
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

		return reservedKeywords.indexOf(identifier) !== 1 &&
			validVarNameRegex.test(identifier);
	}
}
