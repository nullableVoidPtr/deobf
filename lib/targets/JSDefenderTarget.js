import TargetCurry from './TargetCurry.js'

export default TargetCurry([
	import('../transforms/BooleanPass.js'),
	import('../transforms/jsdefender/StringLiteralPass.js'),
	import('../transforms/DotNotationPass.js'),
	import('../transforms/jsdefender/IntegerLiteralPass.js'),
	import('../transforms/jsdefender/ControlFlowRecoveryPass.js'),
	import('../transforms/jsdefender/LabelRemovalPass.js'),
	import('../transforms/javascript-obfuscator/DomainLockRemovalPass.js'), // Interesting.
	import('../transforms/javascript-obfuscator/CallControllerRemovalPass.js'),
	import('../transforms/EmptyIIFERemovalPass.js'),
]);
