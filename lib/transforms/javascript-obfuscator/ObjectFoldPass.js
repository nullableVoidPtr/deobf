const estraverse = require('estraverse')
const utils = require('../../utils.js')

module.exports = class ObjectFoldPass extends require('../BasePass.js') {
	static get repeatUntilStable() {
		return true;
	}

	static _transform(tree) {
		let folded = false;
		estraverse.traverse(tree, {
			leave: scope => utils.modifyScope(scope,
				(objectDecl, index, body) => {
					objectDecl = objectDecl.declarations[0];
					while (index !== body.length - 1 &&
						utils.specMatch(body[index + 1],
							utils.parseStatement(`${objectDecl.id.name}[$_IGNORE_] = $_IGNORE_`))) {
						let propertyDecl = body[index + 1].expression
						objectDecl.init.properties.push({
							type: 'Property',
							key: propertyDecl.left.property,
							value: propertyDecl.right,
						})
						folded = true;
						body.splice(index + 1, 1);
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
						estraverse.replace(body[index + 1], {
							enter: (identifier) => {
								if (utils.specMatch(identifier, {
									type: 'Identifier',
									name: objectDecl.id.name,
								})) {
									folded = true;
									body.splice(index, 1);
									return objectDecl.init;
								}
							}
						})
					}
				},
				objectDecl => utils.specMatch(objectDecl, utils.parseStatement('var $_IGNORE_ = $_ObjectExpression_')),
				objectDecl => objectDecl.declarations[0].id.name),
		});
		utils.removeEmptyVarDecls(tree);
		return folded;
	}
}
