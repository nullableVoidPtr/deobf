import estraverse from 'estraverse';
import * as utils from '../../utils.js';

export const yargsOptions = {
	'dead-code-removal-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	}
};

export default tree => {
	let deadCodeRemoved = false;
	estraverse.traverse(tree, {
		enter: (scope) => {
			if (scope.type !== 'BlockStatement') {
				return;
			}
			let ifIndex = scope.body.findIndex((statement) =>
				utils.specMatch(statement, {
					type: 'IfStatement',
					test: {
						type: 'Literal',
					}
				}) && statement.consequent !== null);
			if (ifIndex === -1) {
				return;
			}
			let ifStatement = scope.body[ifIndex];
			let activeStatements = (ifStatement.test.value) ? ifStatement.consequent : ifStatement.alternate;
			deadCodeRemoved = true;
			scope.body.splice(ifIndex, 1, ...(activeStatements.type === 'BlockStatement') ?
				activeStatements.body :
				[activeStatements]);
		}
	});
	return deadCodeRemoved;
};
