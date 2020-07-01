import TargetCurry from './TargetCurry.js';

export default TargetCurry([
	'javascript-obfuscator/StringArrayPass',
	'javascript-obfuscator/StringFoldPass',
	'javascript-obfuscator/ObjectFoldPass',
	'javascript-obfuscator/ControlFlowStoragePass',
	'DotNotationPass',
	'BooleanPass',
	'javascript-obfuscator/DeadCodeRemovalPass',
	'javascript-obfuscator/ControlFlowRecoveryPass',
	'javascript-obfuscator/DebugProtectionRemovalPass',
	'javascript-obfuscator/ConsoleEnablePass',
	'javascript-obfuscator/SelfDefenseRemovalPass',
	'javascript-obfuscator/DomainLockRemovalPass',
	'javascript-obfuscator/CallControllerRemovalPass',
]);
