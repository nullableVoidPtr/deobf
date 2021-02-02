import estraverse from 'estraverse';
import escodegen from 'escodegen';
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

function analyseStringArray(tree) {
	let arrDecl = null;
	estraverse.traverse(tree, {
		enter(node) {
			if (utils.specMatch(node, {
				type: 'VariableDeclarator',
				init: {
					type: 'ArrayExpression'
				},
			})) {
				arrDecl = node;
				return estraverse.VisitorOption.Break;
			}
		}
	});

	if (arrDecl === null) {
		console.error('Array not found');
		return null;
	}

	const identifier = arrDecl.id.name;
	let array = arrDecl.init.elements.map((elem) => elem.value);

	return {
		identifier,
		array,
	};
}

function analyseDecoders(tree, arrIdent, array, obfuscationType, base64CharMap) {
	let originalDecoders = [];
	estraverse.traverse(tree, {
		enter(funcDecl) {
			if (utils.specMatch(funcDecl, {
				type: 'VariableDeclarator',
				init: {
					type: 'FunctionExpression',
				},
			}) &&
				funcDecl.init.params.length === 2) {
				let isDecoder = false;
				estraverse.traverse(funcDecl.init.body, {
					enter: (valueDecl) => {
						if (utils.specMatch(valueDecl, {
							type: 'VariableDeclarator',
							init: {
								type: 'MemberExpression',
								object: {
									type: 'Identifier',
									name: arrIdent,
								},
							},
						})) {
							isDecoder = true;
							return estraverse.VisitorOption.Break;
						}
					}
				});

				if (isDecoder) {
					originalDecoders.push(funcDecl);
					return estraverse.VisitorOption.Skip;
				}
			}
		}
	});

	if (!originalDecoders.length) {
		console.error('Decoder not found');
		return null;
	}

	let results = {};

	const defaultCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	for (let decoder of originalDecoders) {
		let indexParam = decoder.init.params[0].name;
		let shift = 0;
		estraverse.traverse(decoder, {
			enter(assignment) {
				if (utils.specMatch(assignment, utils.parseStatement(`${utils.escapeIdentifier(indexParam)} = ${utils.escapeIdentifier(indexParam)} - $_Literal_`))) {
					shift = -(assignment.expression.right.right.value);
					return estraverse.VisitorOption.Break;
				}
			}
		});
		let isBase64 = false;
		let curry = accessorCurry(array, shift);
		estraverse.traverse(decoder, {
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
								'($_IGNORE_ = $_IGNORE_ % $_Literal_ ? ' +
								'$_IGNORE_ * $_Literal_ + $_IGNORE_ : ' +
								'$_IGNORE_, ' +
								'$_IGNORE_++ % $_Literal_) ? ' +
								'$_IGNORE_ += $_CallExpression_ : ' +
								'$_Literal_'))) {
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
								}) && node.init.value !== '') {
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
		results[decoder.id.name] = curry;
	}

	return results;
}

function replaceFuncExpCall(funcExp, args) {
	let argMap = Object.fromEntries(funcExp.params.map((param, i) => [param.name, args[i]]));
	if (funcExp.body.body.length !== 1 ||
		funcExp.body.body[0].type !== 'ReturnStatement') {
		throw 'Abnormal function';
	}
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
		});
	}
	LiteralFold(expression);
	return expression;
}

function resolveWrappers(tree, decoders) {
	estraverse.traverse(tree, {
		enter: (scope) => utils.modifyScope(
			scope,
			(node, index, body) => {
				let wrappers = Object.fromEntries(
					node.declarations.filter((
						decl => decl.init?.type == 'Identifier' && decl.init.name in decoders ||
						(decl.init?.type == 'FunctionExpression' &&
							decl.init.body.body[0]?.argument?.callee?.name in decoders
						)
					)).map(decl => [decl.id.name, decl.init]));
				node.declarations = node.declarations.filter(decl => !(decl.id.name in wrappers));
				for (let i = index; i < body.length; i++) {
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
								wrappers[node.callee.name]?.type == 'FunctionExpression') {
								let funcExpression = wrappers[node.callee.name];
								return replaceFuncExpCall(funcExpression, node.arguments);
							}
						}
					});
				}
			},
			(node) => node.type == 'VariableDeclaration' &&
				node.declarations.some(decl =>
					(decl.init?.type == 'Identifier' && decl.init.name in decoders) ||
					(decl.init?.type == 'FunctionExpression' &&
						decl.init.body.body[0]?.argument?.callee?.name in decoders
					)
				),
			(node) => node.declarations.map(decl => decl.id.name)
		)
	});
}

function analyseRotators(tree, decoders, array, arrayIdent, rotationAmount) {
	if (typeof rotationAmount === 'undefined') {
		estraverse.traverse(tree, {
			enter(node) {
				if (utils.specMatch(node, utils.parseExpression(`$_FunctionExpression_(${utils.escapeIdentifier(arrayIdent)}, $_Literal_)`))) {
					let isIterative = false;
					let isRotatePredicate = (expression) => {
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

						return false
					};
					let expression;
					estraverse.traverse(node.callee, {
						enter(node) {
							if (node.type == 'VariableDeclarator' &&
								isRotatePredicate(node.init)) {
								expression = node.init;
								isIterative = true;
								return estraverse.VisitorOption.Break;
							}
						}
					});
					if (!isIterative) {
						rotationAmount = node.arguments[1].value;
					} else {
						let script = new vm.Script(escodegen.generate(expression));
						let context = vm.createContext(decoders);
						for (let offset = 0; offset < array.length; offset++) {
							try {
								if (node.arguments[1].value == script.runInContext(context))
									break;
							} catch {}
							array.push(array.shift());
						}
					}
					return estraverse.VisitorOption.Break;
				}
			}
		});
	}

	if (rotationAmount) {
		rotationAmount = ((rotationAmount % array.length) + array.length) % array.length;
		array.push(...array.splice(0, rotationAmount));
	}

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
	'string-rotation': {
		alias: 'r',
		type: 'number',
	},
};

export default (tree, options) => {
	let results = analyseStringArray(tree, options.stringRotation);
	if (results === null) {
		return false;
	}
	let arrIdent = results.identifier;
	let array = results.array;

	let decoders = analyseDecoders(tree, arrIdent, array, options.stringObfuscation, options.base64CharacterMap);

	resolveWrappers(tree, decoders);
	analyseRotators(tree, decoders, array, arrIdent, options.stringRotation);

	let stringArrayRemoved = false, rotatorRemoved = false, decodersRemoved = new Set();
	tree = estraverse.replace(tree, {
		enter: (node) => {
			if (decoders !== null) {
				let matches = utils.specMatch(node, utils.parseExpression('$_Identifier$1_()'));
				if (matches &&
					matches[1].name in decoders) {
					let args = matches[0].arguments.map((literal) => literal.value);
					return {
						type: 'Literal',
						value: decoders[matches[1].name](...args),
					};
				} else if (node.type === 'VariableDeclarator' &&
					node.init?.type === 'FunctionExpression' &&
					node.init.params.length === 2 &&
					!decodersRemoved.has(node.id.name)) {
					decodersRemoved.add(node.id.name);
					return estraverse.VisitorOption.Remove;
				}
			} else if (utils.specMatch(node, {
				type: 'MemberExpression',
				object: {
					type: 'Identifier',
					name: arrIdent,
				},
			})) {
				return {
					type: 'Literal',
					value: array[node.property.value],
				};
			}
			if (!stringArrayRemoved &&
				node.type == 'VariableDeclarator' &&
				node.id.name == arrIdent &&
				node.init.type == 'ArrayExpression') {
				stringArrayRemoved = true;
				return estraverse.VisitorOption.Remove;
			} else if (!rotatorRemoved &&
				utils.specMatch(node, {
					type: 'ExpressionStatement',
					expression: {
						type: 'CallExpression',
						arguments: [
							{
								type: 'Identifier',
								name: arrIdent
							},
							{
								type: 'Literal',
							},
						]
					}
				})) {
				rotatorRemoved = true;
				return estraverse.VisitorOption.Remove;
			}
		}
	});
	utils.removeEmptyVarDecls(tree);
	return true;
};
