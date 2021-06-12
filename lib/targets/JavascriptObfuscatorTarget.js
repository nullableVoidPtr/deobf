import TargetComposer from './TargetComposer.js';

export default TargetComposer([
	'terser/StatementDelineationPass',
	[
		'terser/SequenceStatementPass',
		'terser/ConditionalStatementPass',
	],
	'LiteralFoldPass',
	'javascript-obfuscator/StringArrayPass',
	'LiteralFoldPass',
	'javascript-obfuscator/ObjectFoldPass',
	'javascript-obfuscator/ControlFlowStoragePass',
	'DotNotationPass',
	'LiteralFoldPass',
	'javascript-obfuscator/DeadCodeRemovalPass',
	'javascript-obfuscator/ControlFlowRecoveryPass',
	'javascript-obfuscator/DebugProtectionRemovalPass',
	'javascript-obfuscator/ConsoleEnablePass',
	'javascript-obfuscator/SelfDefenseRemovalPass',
	'javascript-obfuscator/DomainLockRemovalPass',
	'javascript-obfuscator/CallControllerRemovalPass',
]);
