module.exports = class JSDefenderTarget extends require('./BaseTarget') {
	static get passes() {
		return [
			require('../transforms/BooleanPass.js'),
			require('../transforms/jsdefender/StringLiteralPass.js'),
			require('../transforms/DotNotationPass.js'),
			require('../transforms/jsdefender/IntegerLiteralPass.js'),
			require('../transforms/jsdefender/ControlFlowRecoveryPass.js'),
			require('../transforms/jsdefender/LabelRemovalPass.js')
		];
	}
}
