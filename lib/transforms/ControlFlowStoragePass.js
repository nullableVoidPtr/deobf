const BasePass = require('./BasePass.js')
const estraverse = require('estraverse')
const utils = require('../utils.js')

function findControlFlowStorage(statements) {
	for (let statement of statements) {
		if (statement.type === 'VariableDeclaration') {
			for (let objectDecl of statement.declarations) {
				if (objectDecl.type === 'VariableDeclarator' &&
					objectDecl.init?.type === 'ObjectExpression' &&
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
			if (storageAccess.type === 'MemberExpression' &&
				storageAccess.object.type === 'Identifier' &&
				storageAccess.object.name === controlFlowStorage.id.name &&
				storageAccess.property.type === 'Literal' &&
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
		estraverse.replace(tree, {
			enter: (scope) => {
				let controlFlowStorage;
				if (['BlockStatement', 'SwitchStatement'].indexOf(scope.type) !== -1) {
					controlFlowStorage = analyseScope(scope);
				}
				if (typeof controlFlowStorage === 'undefined') {
					return;
				}
				scope = estraverse.replace(scope, {
					enter: (node) => {
						if (node.type === 'VariableDeclarator' &&
							node.id.name === controlFlowStorage.name) {
							replaced = true;
							return estraverse.VisitorOption.Remove;
						}
						if (node.type === 'CallExpression' &&
							node.callee.type === 'MemberExpression' &&
							node.callee.object.type === 'Identifier' &&
							node.callee.object.name === controlFlowStorage.name &&
							node.callee.property.type === 'Literal') {
							let funcExpression = controlFlowStorage.object[node.callee.property.value];
							let argMap = Object.fromEntries(funcExpression.params.map((param, i) => [param.name, node.arguments[i]]));
							if (funcExpression.body.body.length !== 1 ||
								funcExpression.body.body[0].type !== 'ReturnStatement') {
								throw `Abnormal function ${controlFlowStorage.name}[${node.callee.property.value}]`;
							}
							replaced = true;
							//Hacky bodge that fixes some heap allocation failures
							//TODO: lambda which generates a proper expression?
							let expression = JSON.parse(JSON.stringify(funcExpression.body.body[0].argument));
							return estraverse.replace(expression, {
								enter: (ident) => {
									if (ident.type === 'Identifier' &&
										ident.name in argMap) {
										return argMap[ident.name];
									}
								}
							});
						}
						if (node.type === 'MemberExpression' &&
							node.object.type === 'Identifier' &&
							node.object.name === controlFlowStorage.name &&
							node.property.type === 'Literal') {
							replaced = true;
							return controlFlowStorage.object[node.property.value];
						}
					}
				});
				return scope;
			}
		});
		utils.removeEmptyVarDecls(tree);
		return replaced;
	}
}
