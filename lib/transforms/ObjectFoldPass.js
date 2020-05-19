const BasePass = require('./BasePass.js')
const estraverse = require('estraverse')
const utils = require('../utils.js')

module.exports = class ObjectFoldPass extends BasePass {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree) {
		let folded = false;
		estraverse.traverse(tree, {
			enter: (scope) => {
				if (['BlockStatement', 'Program'].indexOf(scope.type) === -1) {
					return;
				}
				let finalisedObjectIdentifiers = [];
				while (true) {
					let objIndex = scope.body.findIndex((objectDecl) => {
						if (utils.specMatch(objectDecl, {
							type: 'VariableDeclaration',
							declarations: [{
								type: 'VariableDeclarator',
								init: {
									type: 'ObjectExpression'
								},
							}]
						}) && finalisedObjectIdentifiers.indexOf(objectDecl.declarations[0].id.name) === -1) {
							return true;
						}
					});
					if (objIndex === -1 || objIndex === scope.body.length - 1) {
						break;
					}
					let objectDecl = scope.body[objIndex].declarations[0];
					while (objIndex !== scope.body.length - 1 &&
						utils.specMatch(scope.body[objIndex + 1], {
							type: 'ExpressionStatement',
							expression: {
								type: 'AssignmentExpression',
								operator: '=',
								left: {
									type: 'MemberExpression',
									object: {
										type: 'Identifier',
										name: objectDecl.id.name,
									},
								},
							}
						})) {
						let propertyDecl = scope.body[objIndex + 1].expression
						objectDecl.init.properties.push({
							type: 'Property',
							key: propertyDecl.left.property,
							value: propertyDecl.right,
						})
						folded = true;
						scope.body.splice(objIndex + 1, 1);
					}
					let referenceCount = 0;
					estraverse.traverse(scope, {
						enter: (identifier) => {
							if (utils.specMatch(identifier, {
								type: 'Identifier',
								name: objectDecl.id.name,
							})) {
								referenceCount++;
							}
						}
					});
					if (referenceCount === 2) {
						for (let statement of scope.body.slice(objIndex+1)) {
							estraverse.replace(statement, {
								enter: (identifier) => {
									if (utils.specMatch(identifier, {
										type: 'Identifier',
										name: objectDecl.id.name,
									})) {
										folded = true;
										scope.body.splice(objIndex, 1);
										return objectDecl.init;
									}
								}
							})
						}
					}
					finalisedObjectIdentifiers.push(objectDecl.id.name);
				}
			}
		});
		utils.removeEmptyVarDecls(tree);
		return folded;
	}
}
