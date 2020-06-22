const utils = require('../../utils.js');
const estraverse = require('estraverse');

const ScopeBodyMap = {
	'BlockStatement': ['body'],
	'Program': ['body'],
	'SwitchCase': ['consequent'],
};

module.exports = class LabelRemovalPass extends require('../BasePass.js') {
	static _transform(tree, options) {
		estraverse.traverse(tree, {
			leave: (scope) => utils.modifyScope(scope,
				label => {
					let nestedLoopCounter = 0;
					let removeLabel = true;
					estraverse.traverse(label.body, {
						enter(node) {
							if (utils.isLoopStatement(node)) {
								nestedLoopCounter++;
							} else if (['BreakStatement', 'ContinueStatement'].includes(node.type) && node.label !== null) {
								if (nestedLoopCounter === 0 && node.label.name === label.label.name) {
									node.label = null;
								} else {
									removeLabel = false;
								}
							}
						},
						leave(node) {
							if (nestedLoopCounter > 0) {
								nestedLoopCounter--;
							}
						}
					});

					if (removeLabel) {
						delete label.label;
						Object.assign(label, label.body);
					}
				},
				label => label.type === 'LabeledStatement' && utils.isLoopStatement(label.body),
				label => label.label.name),
		});
	}
}

