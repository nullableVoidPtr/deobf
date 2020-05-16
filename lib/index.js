const passes = [require('./transforms/StringArrayPass.js'), require('./transforms/BooleanPass.js')]

module.exports = {
	yargsOptions: Object.assign({}, ...passes.map(pass => pass.yargsOptions)),
	deobfuscateESTree: (tree, options) => {
		for (pass of passes) {
			tree = pass.transform(tree, options)
		}
		return tree;
	}
}
