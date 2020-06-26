module.exports = require('./TargetCurry')([
	require('../transforms/BooleanPass'),
	require('../transforms/terser/StatementDelineationPass'),
	[
		require('../transforms/terser/SequenceStatementPass'),
		require('../transforms/terser/ConditionalStatementPass'),
	],
]);
