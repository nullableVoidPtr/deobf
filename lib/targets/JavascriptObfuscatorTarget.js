module.exports = class JavascriptObfuscatorTarget extends require('./BaseTarget') {
	static get passes() {
		return [
			require('../transforms/javascript-obfuscator/StringArrayPass'),
			require('../transforms/javascript-obfuscator/StringFoldPass'),
			require('../transforms/javascript-obfuscator/ObjectFoldPass'),
			require('../transforms/javascript-obfuscator/ControlFlowStoragePass'),
			require('../transforms/DotNotationPass'),
			require('../transforms/javascript-obfuscator/DeadCodeRemovalPass'),
			require('../transforms/BooleanPass'),
			require('../transforms/javascript-obfuscator/ControlFlowRecoveryPass'),
			require('../transforms/javascript-obfuscator/DebugProtectionRemovalPass'),
			require('../transforms/javascript-obfuscator/ConsoleEnablePass'),
			require('../transforms/javascript-obfuscator/SelfDefenseRemovalPass'),
			require('../transforms/javascript-obfuscator/DomainLockRemovalPass'),
			require('../transforms/javascript-obfuscator/CallControllerRemovalPass'),
		];
	}
}
