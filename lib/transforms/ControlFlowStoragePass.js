const BasePass = require('./BasePass.js')
const estraverse = require('estraverse')
const utils = require('../utils.js')

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

	static _transform(tree) {
		tree = estraverse.replace(tree, {
			enter: (scope) => {
				if (['BlockStatement', 'SwitchStatement'].indexOf(scope.type) !== -1) {
					let controlFlowStorage;
					estraverse.traverse(scope, {
						enter: (objectDecl) => {
							if (objectDecl.type === 'VariableDeclarator' &&
								objectDecl.init?.type === 'ObjectExpression' &&
								objectDecl.init.properties.length !== 0 && 
								objectDecl.init.properties.every((property) => {
									if (property.key.type === 'Literal' &&
										['Literal', 'FunctionExpression'].indexOf(property.value.type) !== -1) {
										let propertyUsed = false;
										estraverse.traverse(scope, {
											enter: (node) => {
												if (node.type === 'MemberExpression' &&
													node.object.type === 'Identifier' &&
													node.object.name === objectDecl.id.name &&
													node.property.type === 'Literal' &&
													node.property.value === property.key.value) {
													propertyUsed = true;
													return estraverse.VisitorOption.Break;
												}
											}
										});
										return propertyUsed;
									}
								})) {
								controlFlowStorage = objectDecl;
							}
						}
					})
					if (typeof controlFlowStorage !== 'undefined') {
						scope = estraverse.replace(scope, {
							enter: (node) => {
								if (node.type === 'VariableDeclarator' &&
									node.id.name === controlFlowStorage.id.name) {
									return estraverse.VisitorOption.Remove;
								}
								if (node.type === 'CallExpression' &&
									node.callee.type === 'MemberExpression' &&
									node.callee.object.type === 'Identifier' &&
									node.callee.object.name === controlFlowStorage.id.name &&
									node.callee.property.type === 'Literal') {
									let funcExpression = controlFlowStorage.init.properties.find((p) => p.key.value === node.callee.property.value).value;
									let argMap = Object.fromEntries(funcExpression.params.map((param, i) => [param.name, node.arguments[i]]));
									if (funcExpression.body.body.length !== 1 ||
										funcExpression.body.body[0].type !== 'ReturnStatement') {
										throw `Abnormal function ${controlFlowStorage.id.name}[${node.callee.property.value}]`;
									}
									return estraverse.replace(funcExpression.body.body[0].argument, {
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
									node.object.name === controlFlowStorage.id.name &&
									node.property.type === 'Literal') {
									return controlFlowStorage.init.properties.find((p) => p.key.value === node.property.value).value;
								}
							}
						});
					}
				}
			}
		});
		return utils.removeEmptyVarDecls(tree);
	}
}
