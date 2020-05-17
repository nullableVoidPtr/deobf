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
			if (typeof value === 'object' &&
				value !== null &&
				typeof node[key] === 'object' &&
				node[key] !== null) {
				return specMatch(node[key], value);
			}
			return value === node[key];
		})
	},
}
