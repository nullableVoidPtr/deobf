import estraverse from 'estraverse';
import * as utils from '../../utils.js';

function findControlFlowStorage(statements) {
	for (let statement of statements) {
		if (statement.type === 'VariableDeclaration') {
			for (let objectDecl of statement.declarations) {
				if (utils.specMatch(objectDecl, {
					type: 'VariableDeclarator',
					init: {
						type: 'ObjectExpression',
					},
				}) &&
					objectDecl.init.properties.length !== 0 &&
					objectDecl.init.properties.every((property) => {
						return ['Literal', 'Identifier'].includes(property.key.type) &&
							['Literal', 'FunctionExpression'].includes(property.value.type);
					})) {
					return objectDecl;
				}
			}
		}
	}

	return null;
}

function analyseScope(scope) {
	let controlFlowStorage = null;
	if (scope.type === 'BlockStatement') {
		controlFlowStorage = findControlFlowStorage(scope.body);
	} else if (scope.type === 'SwitchStatement') {
		for (let switchCase of scope.cases) {
			if ((controlFlowStorage = findControlFlowStorage(switchCase.consequent)) !== null) {
				break;
			}
		}
	}
	if (controlFlowStorage === null) {
		return null;
	}

	return {
		name: controlFlowStorage.id.name,
		object: Object.fromEntries(controlFlowStorage.init.properties.map((property) =>
			[property.key[(property.key.type == 'Literal') ? 'value' : 'name'], property.value]
		)),
	};
}

function replaceFuncExpCall(funcExp, args) {
	let argMap = Object.fromEntries(funcExp.params.map((param, i) => [param.name, args[i]]));
	if (funcExp.body.body.length !== 1 ||
		funcExp.body.body[0].type !== 'ReturnStatement') {
		throw Error('Abnormal function');
	}
	//Hacky bodge that fixes some heap allocation failures
	//TODO: lambda which generates a proper expression?
	let expression = JSON.parse(JSON.stringify(funcExp.body.body[0].argument));
	estraverse.replace(expression, {
		leave: (target) => {
			if (target.type === 'Identifier' &&
				target.name in argMap) {
				return argMap[target.name];
			}
		}
	});
	return expression;
}

export const yargsOptions = {
	'control-flow-storage-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
};

export default tree => {
	let replaced = false;
	estraverse.traverse(tree, {
		enter: (scope) => {
			if (!['BlockStatement', 'SwitchStatement'].includes(scope.type)) {
				return;
			}
			let controlFlowStorage = analyseScope(scope);
			if (controlFlowStorage === null) {
				return;
			}

			estraverse.replace(scope, {
				enter: (node) => {
					let matches;
					if (node.type === 'VariableDeclarator' &&
						node.id.name === controlFlowStorage.name) {
						replaced = true;
						return estraverse.VisitorOption.Remove;
					} else if (matches = utils.specMatch(node, utils.parseExpression(`${controlFlowStorage.name}[$_Literal$1_]()`))) {
						let funcExpression = controlFlowStorage.object[matches[1].value];
						if (typeof funcExpression == 'undefined') {
							throw Error('Reference to non-existent key in storage');
						}
						replaced = true;
						return replaceFuncExpCall(funcExpression, node.arguments);
					} else if (matches = utils.specMatch(node, utils.parseExpression(`${controlFlowStorage.name}[$_Literal$1_]`))) {
						replaced = true;
						return controlFlowStorage.object[matches[1].value];
					}
				}
			});
		}
	});
	estraverse.replace(tree, {
		enter: (node) => {
			if (utils.specMatch(node, {
				type: 'CallExpression',
				callee: {
					type: 'MemberExpression',
					object: {
						type: 'ObjectExpression',
					},
					property: {
						type: 'Literal'
					},
				},
			}) && node.callee.object.properties.some((property) =>
				property.key.value === node.callee.property.value)) {
				replaced = true;
				let funcExpression = node.callee.object.properties.find((property) =>
					property.key.value === node.callee.property.value).value;
				return replaceFuncExpCall(funcExpression, node.arguments);
			} else if (utils.specMatch(node, {
				type: 'MemberExpression',
				object: {
					type: 'ObjectExpression',
				},
				property: {
					type: 'Literal'
				}
			}) && node.object.properties.some((property) =>
				property.key.value === node.property.value)) {
				replaced = true;
				return node.object.properties.find((property) =>
					property.key.value === node.property.value).value;
			}
		}
	});
	utils.removeEmptyVarDecls(tree);
	return replaced;
};
