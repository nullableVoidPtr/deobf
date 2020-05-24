const BasePass = require('./BasePass.js')
const estraverse = require('estraverse')
const utils = require('../utils.js')

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
						return property.key.type === 'Literal' &&
							['Literal', 'FunctionExpression'].indexOf(property.value.type) !== -1;
					})) {
					return objectDecl;
				}
			}
		}
	}
}

function analyseScope(scope) {
	let controlFlowStorage;
	if (scope.type === 'BlockStatement') {
		controlFlowStorage = findControlFlowStorage(scope.body);
	} else if (scope.type === 'SwitchStatement') {
		for (let switchCase of scope.cases) {
			controlFlowStorage = findControlFlowStorage(switchCase.consequent)
			if (typeof controlFlowStorage !== 'undefined') {
				break;
			}
		}
	}
	if (typeof controlFlowStorage === 'undefined') {
		return;
	}

	let isUsed = Object.fromEntries(controlFlowStorage.init.properties.map((property) => [property.key.value, false]));
	estraverse.traverse(scope, {
		enter: (storageAccess) => {
			if (utils.specMatch(storageAccess, utils.parseExpression(`${controlFlowStorage.id.name}[$_Literal_]`)) &&
				storageAccess.property.value in isUsed) {
				isUsed[storageAccess.property.value] = true;
				return estraverse.VisitorOption.skip;
			}
		}
	});
	if (!Object.values(isUsed).every(Boolean)) {
		return;
	}
	return {
		name: controlFlowStorage.id.name,
		object: Object.fromEntries(controlFlowStorage.init.properties.map((property) =>
			[property.key.value, property.value]
		)),
	};
}

function replaceFuncExpCall(funcExp, args) {
	let argMap = Object.fromEntries(funcExp.params.map((param, i) => [param.name, args[i]]));
	if (funcExp.body.body.length !== 1 ||
		funcExp.body.body[0].type !== 'ReturnStatement') {
		throw `Abnormal function`;
	}
	replaced = true;
	//Hacky bodge that fixes some heap allocation failures
	//TODO: lambda which generates a proper expression?
	let expression = JSON.parse(JSON.stringify(funcExp.body.body[0].argument));
	for (let [identifier, argument] of Object.entries(argMap)) {
		estraverse.replace(expression, {
			leave: (target) => {
				if (target.type === 'Identifier' &&
					target.name === identifier) {
					return argument;
				}
			}
		})
	}
	return expression;
}

module.exports = class ControlFlowStoragePass extends BasePass {
	static get yargsOptions() {
		return {
			'control-flow-storage-pass': {
				type: 'boolean',
				default: true,
			}
		};
	}

	static isEnabled(options) {
		return options.controlFlowStoragePass;
	}

	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree) {
		let replaced = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				let controlFlowStorage;
				if (['BlockStatement', 'SwitchStatement'].indexOf(scope.type) !== -1) {
					controlFlowStorage = analyseScope(scope);
				}
				if (typeof controlFlowStorage === 'undefined') {
					return;
				}
				estraverse.replace(scope, {
					enter: (node) => {
						if (node.type === 'VariableDeclarator' &&
							node.id.name === controlFlowStorage.name) {
							replaced = true;
							return estraverse.VisitorOption.Remove;
						} else if (utils.specMatch(node, utils.parseExpression(`${controlFlowStorage.name}[$_Literal_]()`),)) {
							replaced = true;
							let funcExpression = controlFlowStorage.object[node.callee.property.value];
							return replaceFuncExpCall(funcExpression, node.arguments);
						} else if (utils.specMatch(node, utils.parseExpression(`${controlFlowStorage.name}[$_Literal_]`))) {
							replaced = true;
							return controlFlowStorage.object[node.property.value];
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
	}
}
