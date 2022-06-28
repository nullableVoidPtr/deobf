import TargetComposer from './TargetComposer.js';

export default await TargetComposer([
	'BooleanPass',
	'terser/StatementDelineationPass',
	[
		'terser/SequenceStatementPass',
		'terser/ConditionalStatementPass',
	],
]);
