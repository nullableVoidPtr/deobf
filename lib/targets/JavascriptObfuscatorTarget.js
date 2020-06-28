import TargetCurry from './TargetCurry.js'

export default TargetCurry([
	import('../transforms/javascript-obfuscator/StringArrayPass.js'),
	import('../transforms/javascript-obfuscator/StringFoldPass.js'),
	import('../transforms/javascript-obfuscator/ObjectFoldPass.js'),
	import('../transforms/javascript-obfuscator/ControlFlowStoragePass.js'),
	import('../transforms/DotNotationPass.js'),
	import('../transforms/BooleanPass.js'),
	import('../transforms/javascript-obfuscator/DeadCodeRemovalPass.js'),
	import('../transforms/javascript-obfuscator/ControlFlowRecoveryPass.js'),
	import('../transforms/javascript-obfuscator/DebugProtectionRemovalPass.js'),
	import('../transforms/javascript-obfuscator/ConsoleEnablePass.js'),
	import('../transforms/javascript-obfuscator/SelfDefenseRemovalPass.js'),
	import('../transforms/javascript-obfuscator/DomainLockRemovalPass.js'),
	import('../transforms/javascript-obfuscator/CallControllerRemovalPass.js'),
]);
