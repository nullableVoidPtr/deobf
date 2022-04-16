import estraverse from 'estraverse';
import { generate } from 'astring';
import vm from 'vm';
import * as utils from '../../utils.js';
import LiteralFold from '../LiteralFoldPass.js'

const accessorCurry = (array, offset) => (index) => array[Number(index) + offset];
const b64DecCurry = (accessor, alphabet) =>
	((charMap) =>
		(index) =>
			Buffer.from(
				accessor(index).replace(/[a-zA-Z0-9+/=]/g, c => charMap[c]), 'base64'
			).toString('utf8')
	)(Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='].map((c, i) => [c, alphabet[i]])));
const rc4Curry = (b64Dec) => (index, key) => {
	let s = [], j = 0, x, res = '';
	for (let i = 0; i < 256; i++) {
		s[i] = i;
	}
	for (let i = 0; i < 256; i++) {
		j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
		x = s[i];
		s[i] = s[j];
		s[j] = x;
	}
	let i = 0;
	j = 0;
	let str = b64Dec(index);
	for (let y = 0; y < str.length; y++) {
		i = (i + 1) % 256;
		j = (j + s[i]) % 256;
		x = s[i];
		s[i] = s[j];
		s[j] = x;
		res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
	}
	return res;
};

function analyseStringArrayFunction(funcDecl) {
	let innerStringArrayDecl = null;
	let isFunctionRedefined = false;
	let isStringArrayFunction = false;
	estraverse.traverse(funcDecl, {
		enter(node) {
			if (utils.specMatch(node, {
				type: 'VariableDeclarator',
				init: {
					type: 'ArrayExpression'
				}
			}) &&
				node.init.elements.every(elem => elem.type == 'Literal' && typeof elem.value == 'string')) {
				innerStringArrayDecl = node;
				return estraverse.VisitorOption.Skip;
			} else if (utils.specMatch(node, {
				type: 'AssignmentExpression',
				left: {
					type: 'Identifier',
					name: funcDecl.id.name
				}
			}) && innerStringArrayDecl) {
				let innerFunc = node.right;
				if (utils.specMatch(innerFunc.body.body[innerFunc.body.body.length - 1], {
					type: 'ReturnStatement',
					argument: {
						type: 'Identifier',
						name: innerStringArrayDecl.id.name
					}
				})) {
					isFunctionRedefined = true;
					return estraverse.VisitorOption.Skip;
				}
			} else if (utils.specMatch(node, {
				type: 'ReturnStatement',
				argument: {
					type: 'CallExpression',
					callee: {
						type: 'Identifier',
						name: funcDecl.id.name
					}
				}
			}) && isFunctionRedefined) {
				isStringArrayFunction = true;
				return estraverse.VisitorOption.Break;
			}
		}
	});

	if (!isStringArrayFunction) {
		return null;
	}

	return {
		identifier: innerStringArrayDecl.id.name,
		functionIdentifier: funcDecl.id.name,
		array: innerStringArrayDecl.init.elements.map(elem => elem.value)
	};
}

function findStringArrayCandidates(tree) {
	let candidates = [];
	estraverse.traverse(tree, {
		enter(node) {
			if (utils.specMatch(node, {
				type: 'FunctionDeclaration'
			})) {
				let stringArrayFunction = analyseStringArrayFunction(node);
				if (stringArrayFunction !== null) {
					candidates.push(stringArrayFunction);
					return estraverse.VisitorOption.Skip;
				}
			} else if (utils.specMatch(node, {
				type: 'VariableDeclarator',
				init: {
					type: 'ArrayExpression'
				},
			}) &&
				node.init.elements.every(elem => elem.type == 'Literal' && typeof elem.value == 'string')) {
				candidates.push({
					identifier: node.id.name,
					array: node.init.elements.map(elem => elem.value)
				});
			}
		}
	});

	return candidates;
}

function findDecoders(tree, arrayCandidates, obfuscationType, base64CharMap) {
	let potentialDecoders = [];
	estraverse.traverse(tree, {
		enter(node) {
			let funcDecl;

			if (utils.specMatch(node, {
				type: 'VariableDeclarator',
				init: {
					type: 'FunctionExpression',
				},
			})) {
				funcDecl = node.init;
			} else if (node.type == 'FunctionDeclaration') {
				funcDecl = node;
			} else {
				return;
			}

			if (funcDecl.params.length === 2) {
				let foundReference = null;
				estraverse.traverse(funcDecl.body, {
					enter: (valueDecl) => {
						if (utils.specMatch(valueDecl, {
							type: 'VariableDeclarator',
							init: {
								type: 'MemberExpression',
								object: {
									type: 'Identifier',
								},
							},
						}) &&
							arrayCandidates.map(c => c.identifier).includes(valueDecl.init.object.name)) {
							foundReference = arrayCandidates.find(c => c.identifier == valueDecl.init.object.name);
							return estraverse.VisitorOption.Break;
						} else if (utils.specMatch(valueDecl, {
							type: 'VariableDeclarator',
							init: {
								type: 'CallExpression',
								callee: {
									type: 'Identifier',
								}
							}
						}) &&
							arrayCandidates.filter(c => 'functionIdentifier' in c).map(c => c.functionIdentifier).includes(valueDecl.init.callee.name)) {
							foundReference = arrayCandidates.find(c => c?.functionIdentifier == valueDecl.init.callee.name);
							return estraverse.VisitorOption.Break;
						}
					}
				});

				if (foundReference !== null) {
					potentialDecoders[node.id.name] = {declaration: funcDecl, arrayReference: foundReference};
					return estraverse.VisitorOption.Skip;
				}
			}
		}
	});

	if (!Object.keys(potentialDecoders).length) {
		console.error('Decoder not found');
		return null;
	}

	let results = {};

	const defaultCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	for (let [name, {declaration, arrayReference}] of Object.entries(potentialDecoders)) {
		let indexParams = [declaration.params[0].name];
		let shift = 0;
		estraverse.traverse(declaration, {
			enter(assignment) {
				let matches = utils.specMatch(assignment, utils.parseStatement('$_Identifier$1_ = $_Identifier$1_ - $_Literal$2_'));
				if (matches && indexParams.includes(matches[1].name)) {
					shift = -(matches[2].value);
					return estraverse.VisitorOption.Break;
				} else if (matches = utils.specMatch(assignment, utils.parseExpression(`${utils.escapeIdentifier(name)} = $_FunctionExpression$1_`))) {
					indexParams.push(matches[1].params[0].name);
				}
			}
		});
		let isBase64 = false;
		let curry = accessorCurry(arrayReference.array, shift);
		estraverse.traverse(declaration, {
			leave(node) {
				if (utils.specMatch(node, utils.parseExpression('atob()'))) {
					curry = b64DecCurry(curry, defaultCharMap);
					isBase64 = true;
				} else if (!isBase64 && utils.specMatch(node, {
					type:'VariableDeclarator',
					init: {
						type: 'FunctionExpression'
					},
				})) {
					estraverse.traverse(node.init, {
						enter(node) {
							if (utils.specMatch(node, utils.parseExpression('~$_IGNORE_ && ' +
								'($_IGNORE_ = $_IGNORE_ % 4 ? ' +
								'$_IGNORE_ * 64 + $_IGNORE_ : ' +
								'$_IGNORE_, ' +
								'$_IGNORE_++ % 4) ? ' +
								'$_IGNORE_ += $_IGNORE_ : ' +
								'0'))) {
								isBase64 = true;
								return estraverse.VisitorOption.Break;
							}
						}
					});
					if (!isBase64) {
						return;
					}
					if (typeof base64CharMap === 'undefined') {
						estraverse.traverse(node, {
							enter(node) {
								if (utils.specMatch(node, {
									type:'VariableDeclarator',
									init: {
										type: 'Literal'
									},
								}) &&
									typeof node.init.value == 'string' &&
									node.init.value !== '') {
									base64CharMap = node.init.value;
									return estraverse.VisitorOption.Break;
								}
							}
						});
						if (typeof base64CharMap === 'undefined') {
							return;
						}
					}
					curry = b64DecCurry(curry, base64CharMap);
				} else if (utils.specMatch(node, utils.parseExpression('$_IGNORE_ ^ $_IGNORE_[$_IGNORE_ % $_IGNORE_]')) &&
					isBase64) {
					curry = rc4Curry(curry);
					return estraverse.VisitorOption.Break;
				}
			}
		});
		results[name] = {decode: curry, arrayReference};
	}

	return results;
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
	LiteralFold(expression);
	return expression;
}

function resolveWrappers(tree, decoders) {
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(
			scope,
			(node, index, body) => {
				let wrappers = {};
				if (node.type == 'VariableDeclaration') {
					wrappers = Object.fromEntries(
						node.declarations.filter((
							decl => decl.init?.type == 'Identifier' && decl.init.name in decoders ||
							(decl.init?.type == 'FunctionExpression' &&
								decl.init.body.body[0]?.argument?.callee?.name in decoders
							)
						)).map(decl => [decl.id.name, decl.init]));
					node.declarations = node.declarations.filter(decl => !(decl.id.name in wrappers));
				} else if (node.type == 'FunctionDeclaration') {
					wrappers[node.id.name] = node;
					body.splice(index, 1);
				} else {
					throw Error(`Unexpected node type ${node.type}`);
				}

				for (let i = 0; i < body.length; i++) {
					estraverse.replace(body[i], {
						enter(node) {
							if (node.type == 'Identifier' &&
								wrappers[node.name]?.type == 'Identifier') {
								return {
									type: 'Identifier',
									name: wrappers[node.name].name
								};
							} else if (node.type == 'CallExpression' &&
								node.callee.type == 'Identifier' &&
								['FunctionExpression', 'FunctionDeclaration'].includes(wrappers[node.callee.name]?.type)) {
								let funcExpression = wrappers[node.callee.name];
								return replaceFuncExpCall(funcExpression, node.arguments);
							}
						}
					});
				}
			},
			(node) => (node.type == 'VariableDeclaration' &&
				node.declarations.some(decl =>
					(decl.init?.type == 'Identifier' && decl.init.name in decoders) ||
					(decl.init?.type == 'FunctionExpression' &&
						decl.init.body.body[0]?.argument?.callee?.name in decoders
					)
				)) ||
				(node.type == 'FunctionDeclaration' &&
					node.body.body[0]?.argument?.callee?.name in decoders),
			(node) => {
				if (node.type == 'VariableDeclaration') {
					return node.declarations.map(decl => decl.id.name);
				} else if (node.type == 'FunctionDeclaration') {
					return node.id.name;
				} else {
					throw Error(`Unexpected node type ${node.type}`);
				}
			}
		)
	});
}

function analyseRotators(tree, decoders) {
	estraverse.traverse(tree, {
		enter(node) {
			if (utils.specMatch(node, utils.parseExpression("$_FunctionExpression_($_Identifier_, $_Literal_)"))) {
				let associatedArray = Object.values(decoders).map(d => d.arrayReference).find(ar => node.arguments[0].name == ar.identifier || node.arguments[0].name == ar.functionIdentifier);
				if (typeof associatedArray == 'undefined') {
					return estraverse.VisitorOption.Continue;
				}
				let isIterative = false;
				let isRotatePredicate = (expression) => {
					if (expression.type == 'Literal') {
						return true;
					}

					if (expression.type == 'BinaryExpression' &&
						isRotatePredicate(expression.left) &&
						isRotatePredicate(expression.right))
						return true;

					if (expression.type == 'UnaryExpression' &&
						isRotatePredicate(expression.argument))
						return true;

					if (utils.specMatch(expression, utils.parseExpression('parseInt($_Identifier_($_IGNORE_))'))) {
						return true;
					}

					return false;
				};
				let expression;
				estraverse.traverse(node.callee, {
					enter(node) {
						if (node.type == 'VariableDeclarator' &&
							isRotatePredicate(node.init)) {
							expression = node.init;
							let parseIntCalled = false;
							estraverse.traverse(node.init, {
								enter(call) {
									if (call.type == 'CallExpression' &&
										call.callee.type == 'Identifier' &&
										call.callee.name == 'parseInt') {
										parseIntCalled = true;
										return estraverse.VisitorOption.Break;
									}
								}
							});
							isIterative = parseIntCalled;
							return estraverse.VisitorOption.Break;
						}
					}
				});
				if (!isIterative) {
					let array = associatedArray.array;
					let rotationAmount = node.arguments[1].value;
					rotationAmount = ((rotationAmount % array.length) + array.length) % array.length;
					array.push(...array.splice(0, rotationAmount));
				} else {
					//TODO Identify decoders this way and analyse
					if (decoders === null) {
						throw Error("Iterative rotator without decoder found");
					}
					let script = new vm.Script(generate(expression));
					let vmContext = {};
					for (const identifier in decoders) {
						vmContext[identifier] = decoders[identifier].decode;
					}
					let context = vm.createContext(vmContext);
					let array = associatedArray.array;

					for (let offset = 0; offset < array.length; offset++) {
						try {
							if (node.arguments[1].value == script.runInContext(context)) {
								break;
							}
						} catch (scriptError) {
						}
						array.push(array.shift());
					}
				}
				return estraverse.VisitorOption.Skip;
			}
		}
	});
}

export const yargsOptions = {
	'string-array-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
	'base64-character-map': {
		type: 'string',
	},
};

export default (tree, options) => {
	let candidates = findStringArrayCandidates(tree, options.stringRotation);
	if (candidates === null) {
		return false;
	}

	let decoders = findDecoders(tree, candidates, options.stringObfuscation, options.base64CharacterMap);

	if (decoders !== null) {
		resolveWrappers(tree, decoders);
	}
	analyseRotators(tree, decoders);

	let positiveStringArrays = {};
	let positiveStringArrayFunctions = {};

	for (let arrayRef of Object.values(decoders).map(d => d.arrayReference)) {
		if ('functionIdentifier' in arrayRef) {
			positiveStringArrayFunctions[arrayRef.functionIdentifier] = arrayRef.array;
		} else {
			positiveStringArrays[arrayRef.identifier] = arrayRef.array;
		}
	}

	tree = estraverse.replace(tree, {
		enter: (node) => {
			if (decoders !== null) {
				let matches = utils.specMatch(node, utils.parseExpression('$_Identifier$1_()'));
				if (matches &&
					matches[1].name in decoders) {
					let args = matches[0].arguments.map((literal) => literal.value);
					return {
						type: 'Literal',
						value: decoders[matches[1].name].decode(...args),
					};
				} else if (node.type == 'VariableDeclarator' &&
					node.init?.type == 'FunctionExpression' &&
					node.init.params.length === 2 &&
					node.id.name in decoders) {
					return estraverse.VisitorOption.Remove;
				} else if (node.type == 'FunctionDeclaration' &&
					node.params.length === 2 &&
					node.id.name in decoders) {
					return estraverse.VisitorOption.Remove;
				}
			} else if (utils.specMatch(node, {
				type: 'MemberExpression',
				object: {
					type: 'Identifier',
				},
			}) &&
				node.object.name in positiveStringArrays) {
				return {
					type: 'Literal',
					value: positiveStringArrays[node.object.name][node.property.value],
				};
			}
			if (node.type == 'VariableDeclarator' &&
				node.id.name in positiveStringArrays &&
				node.init.type == 'ArrayExpression') {
				return estraverse.VisitorOption.Remove;
			} else if (node.type == 'FunctionDeclaration' &&
				node.id.name in positiveStringArrayFunctions) {
				return estraverse.VisitorOption.Remove;
			} else if (utils.specMatch(node, {
				type: 'ExpressionStatement',
				expression: {
					type: 'CallExpression',
					arguments: [
						{
							type: 'Identifier',
						},
						{
							type: 'Literal',
						},
					]
				}
			}) && (
				node.expression.arguments[0].name in positiveStringArrayFunctions ||
				node.expression.arguments[0].name in positiveStringArrays
			)) {
				return estraverse.VisitorOption.Remove;
			}
		}
	});
	utils.removeEmptyVarDecls(tree);
	return true;
};
