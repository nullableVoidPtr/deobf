const passes = [
	require('./transforms/StringArrayPass.js'),
	require('./transforms/StringFoldPass.js'),
	require('./transforms/ObjectFoldPass.js'),
	require('./transforms/ControlFlowStoragePass.js'),
	require('./transforms/DotNotationPass.js'),
	require('./transforms/DeadCodeRemovalPass.js'),
	require('./transforms/BooleanPass.js'),
	require('./transforms/ControlFlowRecoveryPass.js'),
	require('./transforms/DebugProtectionRemovalPass.js'),
	require('./transforms/ConsoleEnablePass.js'),
	require('./transforms/SelfDefenseRemovalPass.js'),
	require('./transforms/DomainLockRemovalPass.js'),
	require('./transforms/CallControllerRemovalPass.js'),
];

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
