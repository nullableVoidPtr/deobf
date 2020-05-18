const passes = [
	require('./transforms/StringArrayPass.js'),
	require('./transforms/StringFoldPass.js'),
	require('./transforms/ControlFlowStoragePass.js'),
	require('./transforms/DeadCodeRemovalPass.js'),
	require('./transforms/BooleanPass.js'),
	require('./transforms/ControlFlowRecoveryPass.js'),
	require('./transforms/DebugProtectionRemovalPass.js')
]

module.exports = {
	yargsOptions: Object.assign({}, ...passes.map(pass => pass.yargsOptions)),
	deobfuscateESTree: (tree, options) => {
		for (let pass of passes) {
			let transformed = false;
			do {
				transformed = pass.transform(tree, options);
			} while (pass.repeatUntilStable && transformed);
		}
	}
}
