module.exports = require('./TargetCurry')([
	require('../transforms/BooleanPass'),
	require('../transforms/jsdefender/StringLiteralPass'),
	require('../transforms/DotNotationPass'),
	require('../transforms/jsdefender/IntegerLiteralPass'),
	require('../transforms/jsdefender/ControlFlowRecoveryPass'),
	require('../transforms/jsdefender/LabelRemovalPass'),
	require('../transforms/javascript-obfuscator/DomainLockRemovalPass'), // Interesting.
	require('../transforms/javascript-obfuscator/CallControllerRemovalPass'),
	require('../transforms/EmptyIIFERemovalPass'),
]);
