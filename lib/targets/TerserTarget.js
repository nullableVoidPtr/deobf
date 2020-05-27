const BaseTarget = require('./BaseTarget'); 

const passes = [
	require('../transforms/BooleanPass.js'),
	require('../transforms/terser/StatementDelineationPass.js'),
	[
		require('../transforms/terser/SequenceStatementPass.js'),
		require('../transforms/terser/ConditionalStatementPass.js'),
	],
];

module.exports = class JavascriptObfuscatorTarget extends BaseTarget {
	static get passes() {
		return passes;
	}
}
