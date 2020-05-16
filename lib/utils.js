const estraverse = require('estraverse')

module.exports = {
	removeEmptyVarDecls: (tree) => {
		return estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'VariableDeclaration' &&
					node.declarations.length === 0) {
					return estraverse.VisitorOption.Remove;
				}
			}
		});
	}
}