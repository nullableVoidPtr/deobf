import TargetComposer from './TargetComposer.js';

export default TargetComposer([
	'jsdefender/GlobalObjectPass',
	'LiteralFoldPass',
	'jsdefender/ControlFlowRecoveryPass',
]);

