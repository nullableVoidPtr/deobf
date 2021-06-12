import TargetComposer from './TargetComposer.js';

export default TargetComposer([
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
