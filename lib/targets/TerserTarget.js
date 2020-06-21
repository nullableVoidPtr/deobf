module.exports = class JavascriptObfuscatorTarget extends require('./BaseTarget') {
	static get passes() {
		return [
			require('../transforms/BooleanPass.js'),
			require('../transforms/terser/StatementDelineationPass.js'),
			[
				require('../transforms/terser/SequenceStatementPass.js'),
				require('../transforms/terser/ConditionalStatementPass.js'),
			],
		];
	}
}
