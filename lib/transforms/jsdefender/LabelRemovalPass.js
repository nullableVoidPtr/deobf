import estraverse from 'estraverse';
import * as utils from '../../utils.js';

export default tree => {
	estraverse.replace(tree, {
		leave(label) {
			if (label.type !== 'LabeledStatement' || !utils.isLoopStatement(label.body)) {
				return;
			}

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
				leave() {
					if (nestedLoopCounter > 0) {
						nestedLoopCounter--;
					}
				}
			});

			if (removeLabel) {
				return label.body;
			}
		}
	});
};
