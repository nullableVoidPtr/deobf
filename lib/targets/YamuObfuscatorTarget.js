import TargetComposer from './TargetComposer.js';

export default TargetComposer([
	'yamu/LoopArrayPass',
	'yamu/ControlFlowRecoveryPass',
	'yamu/StringRecoveryPass',
	'LiteralFoldPass'
]);

