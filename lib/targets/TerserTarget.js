import TargetCurry from './TargetCurry.js';

export default TargetCurry([
	'BooleanPass',
	'terser/StatementDelineationPass',
	[
		'terser/SequenceStatementPass',
		'terser/ConditionalStatementPass',
	],
]);
