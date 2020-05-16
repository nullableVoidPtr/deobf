const stringArrayPass = require('./transforms/stringArrayPass.js');
const booleanPass = require('./transforms/booleanPass.js');

module.exports = {
	yargsOptions: Object.assign({}, stringArrayPass.yargsOptions),
	deobfuscateESTree: (tree, options) => {
		if (options.stringObfuscation !== 'none') {
			tree = stringArrayPass.pass(tree, options.stringObfuscation, options.stringRotation);
		}
		tree = booleanPass.pass(tree);
		return tree;
	}
}
