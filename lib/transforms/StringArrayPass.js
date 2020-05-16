const BasePass = require('./BasePass.js');
const utils = require('../utils.js');
const estraverse = require('estraverse');

function analyseStringArray(tree, obfuscationType, rotationAmount) {
	const stringArrayDecoders = {
		'array': (array, index) => array[index - 0],
		'base64': (array, index) => Buffer.from(array[index - 0], 'base64').toString('utf8'),
		'rc4': (array, index, key) => {
			var s = [], j = 0, x, res = '';
			for (var i = 0; i < 256; i++) {
				s[i] = i;
			}
			for (i = 0; i < 256; i++) {
				j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
				x = s[i];
				s[i] = s[j];
				s[j] = x;
			}
			i = 0;
			j = 0;
			str = Buffer.from(array[index - 0], 'base64').toString('utf8');
			for (var y = 0; y < str.length; y++) {
				i = (i + 1) % 256;
				j = (j + s[i]) % 256;
				x = s[i];
				s[i] = s[j];
				s[j] = x;
				res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
			}
			return res;
		}
	};

	let arrDecl;
	estraverse.traverse(tree, {
		enter: (node) => {
			if (node.type === 'VariableDeclarator' && node.init.type === 'ArrayExpression') {
				arrDecl = node;
				return estraverse.VisitorOption.Break;
			}
		}
	});
	if (typeof arrDecl === 'undefined') {
		throw 'no array detected';
	}

	const arrIdent = arrDecl.id.name;
	let arr = arrDecl.init.elements.map((elem) => elem.value);

	if (typeof rotationAmount === 'undefined') {
		estraverse.traverse(tree, {
			enter: (node) => {
				if (node.type === 'CallExpression' &&
					node.arguments.length === 2 &&
					node.arguments[0].type === 'Identifier' &&
					node.arguments[0].name === arrIdent &&
					node.arguments[1].type === 'Literal') {
					rotationAmount = node.arguments[1].raw >> 0
					return estraverse.VisitorOption.Break;
				}
			}
		});
	}

	if (rotationAmount) {
		rotationAmount = ((rotationAmount % arr.length) + arr.length) % arr.length;
		arr.push(...arr.splice(0, rotationAmount));
	}

	let originalDecoder;
	estraverse.traverse(tree, {
		enter: (funcDecl) => {
			if (funcDecl.type === 'VariableDeclarator' &&
				funcDecl.init.type === 'FunctionExpression' &&
				funcDecl.init.params.length === 2) {
				let isDecoder = false;
				estraverse.traverse(funcDecl.init.body, {
					enter: (valueDecl) => {
						if (valueDecl.type === 'VariableDeclarator' &&
							valueDecl.init.type === 'MemberExpression' &&
							valueDecl.init.object.type === 'Identifier' &&
							valueDecl.init.object.name === arrIdent) {
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

	let decoder = stringArrayDecoders['array'];
	if (obfuscationType !== 'auto') {
		if (!(obfuscationType in stringArrayDecoders)) {
			throw `Invalid obfuscationType ${obfuscationType}`;
		}
		decoder = stringArrayDecoders[obfuscationType];
	} else {
		estraverse.traverse(originalDecoder, {
			enter: (node) => {
				if (node.type === 'CallExpression' &&
					node.callee.type === 'Identifier' &&
					node.callee.name === 'atob') {
					decoder = stringArrayDecoders['base64'];
				} else if (node.type === 'BinaryExpression' &&
					node.operator === '^' &&
					node.right.type === 'MemberExpression' &&
					node.right.property.type === 'BinaryExpression' &&
					node.right.property.operator === '%' &&
					decoder === stringArrayDecoders['base64']) {
					decoder = stringArrayDecoders['rc4'];
					return estraverse.VisitorOption.Break;
				}
			}
		});
	}

	return {
		arrIdent: arrIdent,
		decoderIdent: originalDecoder.id.name,
		decoder: decoder.bind(null, arr),
	};
}

module.exports = class StringArrayPass extends BasePass {
	static isEnabled(options) {
		return options.stringArrayPass;
	}

	static get yargsOptions() {
		return {
			'string-array-pass': {
				type: 'boolean',
				default: true,
			},
			'string-obfuscation': {
				alias: 's',
				choices: ['auto', 'array', 'base64', 'rc4'],
				type: 'string',
				default: 'auto',
			},
			'string-rotation': {
				alias: 'r',
				type: 'number',
			}
		};
	}

	static _transform(tree, options) {
		const {arrIdent, decoderIdent, decoder} = analyseStringArray(tree, options.stringObfuscation, options.rotationAmount);
		let stringArrayRemoved = false, rotatorRemoved = false, decoderRemoved = false;
		tree = estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'CallExpression' &&
					node.callee.type === 'Identifier' &&
					node.callee.name === decoderIdent) {
					let args = node.arguments.map((literal) => literal.value);
					return {
						type: 'Literal',
						value: decoder(...args),
					}
				}

				if (!stringArrayRemoved &&
					node.type === 'VariableDeclarator' &&
					node.id.name === arrIdent &&
					node.init.type === 'ArrayExpression') {
					stringArrayRemoved = true;
					return estraverse.VisitorOption.Remove;
				}

				if (!rotatorRemoved && 
					node.type === 'ExpressionStatement' &&
					node.expression.type === 'CallExpression' &&
					node.expression.arguments.length === 2 &&
					node.expression.arguments[0].type === 'Identifier' &&
					node.expression.arguments[0].name === arrIdent &&
					node.expression.arguments[1].type === 'Literal') {
					rotatorRemoved = true;
					return estraverse.VisitorOption.Remove;
				}

				if (!decoderRemoved && node.type === 'VariableDeclarator' &&
					node.init.type === 'FunctionExpression' &&
					node.init.params.length === 2) {
					let isDecoder = false;
					estraverse.traverse(node.init.body, {
						enter: (valueDecl) => {
							if (valueDecl.type === 'VariableDeclarator' &&
								valueDecl.init.type === 'MemberExpression' &&
								valueDecl.init.object.type === 'Identifier' &&
								valueDecl.init.object.name === arrIdent) {
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
			}
		});
		return utils.removeEmptyVarDecls(tree);
	}
}