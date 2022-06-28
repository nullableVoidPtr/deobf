import TargetComposer from './TargetComposer.js';

export default await TargetComposer([
	'yamu/LoopArrayPass',
	'yamu/ControlFlowRecoveryPass',
	'yamu/StringRecoveryPass',
	'LiteralFoldPass'
]);

