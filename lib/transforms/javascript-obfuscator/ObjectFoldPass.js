const estraverse = require('estraverse')
const utils = require('../../utils.js')

module.exports = class ObjectFoldPass extends require('../BasePass.js') {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree) {
		let folded = false;
		estraverse.traverse(tree, {
			leave: (scope) => {
				if (!['BlockStatement', 'Program'].includes(scope.type)) {
					return;
				}
				let finalisedObjectIdentifiers = [];
				while (true) {
					let objIndex = scope.body.findIndex((objectDecl) =>
						utils.specMatch(objectDecl, utils.parseStatement('var $_IGNORE_ = $_ObjectExpression_')) &&
						!finalisedObjectIdentifiers.includes(objectDecl.declarations[0].id.name));
					if (objIndex === -1 || objIndex === scope.body.length - 1) {
						break;
					}
					let objectDecl = scope.body[objIndex].declarations[0];
					while (objIndex !== scope.body.length - 1 &&
						utils.specMatch(scope.body[objIndex + 1],
							utils.parseStatement(`${objectDecl.id.name}[$_IGNORE_] = $_IGNORE_`))) {
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
						estraverse.replace(scope.body[objIndex + 1], {
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
					finalisedObjectIdentifiers.push(objectDecl.id.name);
				}
			}
		});
		utils.removeEmptyVarDecls(tree);
		return folded;
	}
}
