import estraverse from 'estraverse';
import * as utils from '../../utils.js';

const accessorCurry = (array) => (index) => array[index - 0];
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

function analyseStringArray(tree, rotationAmount) {
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

	if (typeof rotationAmount === 'undefined') {
		estraverse.traverse(tree, {
			enter(node) {
				if (utils.specMatch(node,
					utils.parseExpression(`$_IGNORE_(${utils.escapeIdentifier(identifier)}, $_Literal_)`))) {
					rotationAmount = node.arguments[1].raw >> 0;
					return estraverse.VisitorOption.Break;
				}
			}
		});
	}

	if (rotationAmount) {
		rotationAmount = ((rotationAmount % array.length) + array.length) % array.length;
		array.push(...array.splice(0, rotationAmount));
	}

	return {
		identifier,
		array,
	};
}

function analyseDecoder(tree, arrIdent, array, obfuscationType, base64CharMap) {
	let originalDecoder = null;
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
					originalDecoder = funcDecl;
					return estraverse.VisitorOption.Break;
				}
			}
		}
	});

	if (originalDecoder === null) {
		console.error('Decoder not found');
		return null;
	}

	let result = {
		identifier: originalDecoder.id.name,
	};

	const defaultCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	if (obfuscationType === 'auto') {
		let isBase64 = false;
		result.decoder = accessorCurry(array);
		estraverse.traverse(originalDecoder, {
			leave(node) {
				if (utils.specMatch(node, utils.parseExpression('atob()'))) {
					result.decoder = b64DecCurry(result.decoder, defaultCharMap);
					isBase64 = true;
				} else if (!isBase64 && utils.specMatch(node, utils.parseStatement('var $_IGNORE_ = $_FunctionExpression_'))) {
					estraverse.traverse(node, {
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
								if (utils.specMatch(node, utils.parseStatement('var $_IGNORE_ = $_Literal_')) && 
									node.declarations[0].init.value !== '') {
									base64CharMap = node.declarations[0].init.value;
									return estraverse.VisitorOption.Break;
								}
							}
						});
						if (typeof base64CharMap === 'undefined') {
							return;
						}
					}
					result.decoder = b64DecCurry(result.decoder, base64CharMap);
				} else if (utils.specMatch(node, utils.parseExpression('$_IGNORE_ ^ $_IGNORE_[$_IGNORE_ % $_IGNORE_]')) &&
					isBase64) {
					result.decoder = rc4Curry(result.decoder);
					return estraverse.VisitorOption.Break;
				}
			}
		});
	} else {
		result.decoder = accessorCurry(array);
		if (obfuscationType !== 'array') {
			result.decoder = b64DecCurry(result.decoder, base64CharMap || defaultCharMap);
			if (obfuscationType !== 'base64') {
				result.decoder = rc4Curry(result.decoder);
			}
		}
	}

	return result;
}

export const yargsOptions = {
	'string-array-pass': {
		type: 'boolean',
		default: true,
		enabler: true,
	},
	'string-obfuscation': {
		alias: 's',
		choices: ['auto', 'array', 'base64', 'rc4'],
		type: 'string',
		default: 'auto',
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

	let decoderIdent, decoder;
	results = analyseDecoder(tree, arrIdent, array, options.stringObfuscation, options.base64CharacterMap);
	let decoderFound = results !== null;
	if (decoderFound) {
		decoderIdent = results.identifier;
		decoder = results.decoder;
	}

	let stringArrayRemoved = false, rotatorRemoved = false, decoderRemoved = false;
	tree = estraverse.replace(tree, {
		enter: (node) => {
			if (decoderFound) {
				if (utils.specMatch(node, utils.parseExpression(`${utils.escapeIdentifier(decoderIdent)}()`))) {
					let args = node.arguments.map((literal) => literal.value);
					return {
						type: 'Literal',
						value: decoder(...args),
					};
				} else if (!decoderRemoved && node.type === 'VariableDeclarator' &&
					node.init?.type === 'FunctionExpression' &&
					node.init.params.length === 2) {
					let isDecoder = false;
					estraverse.traverse(node.init.body, {
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
						decoderRemoved = true;
						return estraverse.VisitorOption.Remove;
					}
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
				utils.specMatch(node, {
					type: 'VariableDeclarator',
					id: {
						name: arrIdent,
					},
					init: {
						type: 'ArrayExpression'
					}
				})) {
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
