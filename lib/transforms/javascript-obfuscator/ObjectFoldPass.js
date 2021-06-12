import estraverse from 'estraverse';
import * as utils from '../../utils.js';

export const repeatUntilStable = true;

export default (tree) => {
	let folded = false;
	estraverse.traverse(tree, {
		leave: scope => utils.modifyScope(scope,
			(decl, index, body) => {
				if (index === -1) {
					return;
				}

				let objectDeclIndex = decl.declarations.findIndex(x => x.init?.type == 'ObjectExpression');
				let objectDecl = decl.declarations[objectDeclIndex];
				while (index !== body.length - 1 &&
					utils.specMatch(body[index + 1],
						utils.parseStatement(`${objectDecl.id.name}[$_IGNORE_] = $_IGNORE_`))) {
					let propertyDecl = body[index + 1].expression;
					objectDecl.init.properties.push({
						type: 'Property',
						key: propertyDecl.left.property,
						value: propertyDecl.right,
						kind: 'init'
					});
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
					for (let i = index + 1; i < body.length; i++) {
						let done;
						estraverse.replace(body[i], {
							enter: (identifier) => {
								if (utils.specMatch(identifier, {
									type: 'Identifier',
									name: objectDecl.id.name,
								})) {
									folded = true;
									decl.declarations.splice(objectDeclIndex, 1);
									done = true;
									return objectDecl.init;
								}
							}
						});
						if (done) {
							folded = true;
							break;
						}
					}
				}
			},
			objectDecl => objectDecl.type == 'VariableDeclaration' && objectDecl.declarations.some(d => d.init?.type == 'ObjectExpression')),
	});
	utils.removeEmptyVarDecls(tree);
	return folded;
};
