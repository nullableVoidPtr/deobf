import TargetCurry from './TargetCurry.js'

export default TargetCurry([
	'BooleanPass',
	'jsdefender/StringLiteralPass',
	'DotNotationPass',
	'jsdefender/IntegerLiteralPass',
	'jsdefender/ControlFlowRecoveryPass',
	'jsdefender/LabelRemovalPass',
	'javascript-obfuscator/DomainLockRemovalPass', // Interesting.
	'javascript-obfuscator/CallControllerRemovalPass',
	'EmptyIIFERemovalPass',
]);
