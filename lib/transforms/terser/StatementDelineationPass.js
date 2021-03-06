import estraverse from 'estraverse';

export default (tree) => {
	let replaced = false;
	estraverse.replace(tree, {
		enter(node) {
			if (node.type === 'IfStatement') {
				if (node.consequent.type !== 'BlockStatement') {
					node.consequent = {
						type: 'BlockStatement',
						body: [node.consequent],
					};
					replaced = true;
				}
				if (node.alternate !== null &&
					node.alternate.type !== 'BlockStatement') {
					node.alternate = {
						type: 'BlockStatement',
						body: [node.alternate],
					};
					replaced = true;
				}
			}
			if (['WithStatement',
				'WhileStatement',
				'DoWhileStatement',
				'ForStatement',
				'ForInStatement'].includes(node.type)) {
				if (node.body.type !== 'BlockStatement') {
					node.body = {
						type: 'BlockStatement',
						body: [node.body],
					};
					replaced = true;
				}
			}
		}
	});
	return replaced;
};
