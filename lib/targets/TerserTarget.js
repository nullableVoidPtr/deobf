import TargetComposer from './TargetComposer.js';

export default TargetComposer([
	'BooleanPass',
	'terser/StatementDelineationPass',
	[
		'terser/SequenceStatementPass',
		'terser/ConditionalStatementPass',
	],
]);
