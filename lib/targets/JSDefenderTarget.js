import TargetCurry from './TargetCurry.js';

export default TargetCurry([
	'BooleanPass',
	'jsdefender/StringLiteralPass',
	'DotNotationPass',
	'LiteralFoldPass',
	'jsdefender/ControlFlowRecoveryPass',
	'jsdefender/LabelRemovalPass',
	'javascript-obfuscator/DomainLockRemovalPass', // Interesting.
	'javascript-obfuscator/CallControllerRemovalPass',
	'EmptyIIFERemovalPass',
]);
