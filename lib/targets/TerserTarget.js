import TargetCurry from './TargetCurry.js'

export default TargetCurry([
	import('../transforms/BooleanPass.js'),
	import('../transforms/terser/StatementDelineationPass.js'),
	[
		import('../transforms/terser/SequenceStatementPass.js'),
		import('../transforms/terser/ConditionalStatementPass.js'),
	],
]);
