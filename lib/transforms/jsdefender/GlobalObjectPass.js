import estraverse from 'estraverse';
import { parse } from 'acorn';
import { generate } from 'astring';
import * as utils from '../../utils.js';
import LiteralFold from '../LiteralFoldPass.js'
import vm from 'vm';

function analyseObfuscatedIIFE(iife) {
	let details = {};
	let clonedArgumentsIdentifier = null;
	let evaledString = null;

	estraverse.traverse(iife, {
		enter(node) {
			if (node.type == 'VariableDeclarator' &&
				utils.specMatch(node.init, utils.parseExpression('Array.prototype.slice.call(arguments)'))) {
				clonedArgumentsIdentifier = node.id.name;
			} else if (node.type == 'ReturnStatement' &&
				node.argument.type == 'CallExpression' &&
				node.argument.callee.type == 'Identifier' &&
				node.argument.callee.name == 'eval') {
				evaledString = node.argument.arguments[0].value;
			}
		}
	});

	if (clonedArgumentsIdentifier === null ||
		evaledString === null) {
		return null;
	}

	//Probably a stupid idea
	let context = {};
	context[clonedArgumentsIdentifier] = [];
	(new vm.Script(evaledString)).runInNewContext(context);

	for (let name in context) {
		if (Object.keys(context[name]).length > 14) {
			return {
				name,
				object: context[name]
			}
		}
	}

	return null;
	/*
	let preKeyMaterial = evaledString.match(/^\((function .+\(.+\) {0,1}\{.+\})\)\(.+\)$/)[1];

	let InnerFunctionCall = parse(evaledString).body[0].expression;
	let encryptedCode = decodeURI(InnerFunctionCall.arguments[0].value);
	LiteralFold(InnerFunctionCall.callee);

	let keyDeriverIdent = null;
	estraverse.traverse(InnerFunctionCall, {
		enter(node) {
			let results;
			if (results = utils.specMatch(node, utils.parseExpression(`$_Identifier$1_(${utils.escapeIdentifier(InnerFunctionCall.callee.id.name)}.toString())`))) {
				keyDeriverIdent = results[1].name;
				return estraverse.VisitorOption.Break;
			}
		}
	});

	if (keyDeriverIdent === null) {
		return null;
	}

	let keyDeriverFunc = null;
	estraverse.traverse(InnerFunctionCall, {
		enter(node) {
			if (node.type == 'FunctionDeclaration' &&
				node.id.name == keyDeriverIdent) {
				keyDeriverFunc = node;
				return estraverse.VisitorOption.Break;
			}
		}
	});

	let seed = null, constB = null;
	let seedIdentifier;

	estraverse.traverse(keyDeriverFunc, {
		enter(node) {
			let results;
			if (results = utils.specMatch(node, utils.parseExpression('$_Identifier$1_ ^= $_Identifier$2_.charCodeAt($_Identifier$3_) * 2 + $_Identifier$2_.charCodeAt($_Identifier$3_ >>> 4) ^ $_Literal$4_'))) {
				seedIdentifier = results[1].name;
				constB = results[4].value;
			}
		}
	});
	
	estraverse.traverse(keyDeriverFunc, {
		enter(node) {
			if (node.type == 'VariableDeclarator' &&
				node.id.name == seedIdentifier) {
				seed = node.init.value;
			}
		}
	});

	if (seed === null || constB === null) {
		return null;
	}

	for (let i = 0; i < preKeyMaterial.length; i++) {
		seed ^= preKeyMaterial.charCodeAt(i) * 2 + preKeyMaterial.charCodeAt(i >>> 4) ^ constB;
	}

	let key = "";
	for (let i = 0; i < 8; i++) {
		let index = seed % 27;
		seed = Math.floor(seed / 27);
		key += index >= 26 ? String.fromCharCode(65 + (index - 26)) : String.fromCharCode(97 + index);
	}

	let decrypted = "";

	for (let i = 0; i < encryptedCode.length; i++) {
		decrypted += String.fromCharCode(encryptedCode.charCodeAt(i) ^ key.charCodeAt(i % key.length));
	}

	debugger;
	*/
}

export default (tree, options) => {
	let globalObject = null;
	estraverse.replace(tree, {
		leave(node) {
			if (node.type == 'CallExpression' &&
				node.callee.type == 'FunctionExpression') {
				globalObject = analyseObfuscatedIIFE(node.callee);
				if (globalObject !== null) {
					return estraverse.VisitorOption.Remove;
				}
			}
			if (node.type == 'UnaryExpression' && node.argument === null) {
				return estraverse.VisitorOption.Remove;
			}
			if (node.type == 'ExpressionStatement' && node.expression === null) {
				return estraverse.VisitorOption.Remove;
			}
			if (globalObject !== null &&
				node.type == 'CallExpression' &&
				node.callee.type == 'MemberExpression' &&
				node.callee.object.type == 'Identifier' &&
				node.callee.object.name == globalObject.name) {
				let value = globalObject.object[
					node.callee.property.type == 'Identifier' ?
					node.callee.property.name :
					node.callee.property.value
				](...node.arguments.map(l => l.value));

				return {
					type: 'Literal',
					value
				}
			}
		}
	});
	utils.removeEmptyVarDecls(tree);
};

