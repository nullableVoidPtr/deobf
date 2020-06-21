module.exports = class JSDefenderTarget extends require('./BaseTarget') {
	static get passes() {
		return [
			require('../transforms/BooleanPass.js'),
			require('../transforms/jsdefender/StringLiteralPass.js'),
			require('../transforms/DotNotationPass.js'),
			require('../transforms/jsdefender/IntegerLiteralPass.js'),
			require('../transforms/jsdefender/ControlFlowRecoveryPass.js'),
			require('../transforms/jsdefender/LabelRemovalPass.js'),
			require('../transforms/javascript-obfuscator/DomainLockRemovalPass.js'), // Interesting.
			require('../transforms/javascript-obfuscator/CallControllerRemovalPass.js'),
			require('../transforms/EmptyIIFERemovalPass.js'),
		];
	}
}
