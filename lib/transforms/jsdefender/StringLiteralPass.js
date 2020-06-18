const BasePass = require('./../BasePass.js');
const utils = require('../../utils.js');
const estraverse = require('estraverse');

module.exports = class StringLiteralPass extends BasePass {
	static isEnabled(options) {
		return options.stringLiteralPass;
	}

	static get yargsOptions() {
		return {
			'string-literal-pass': {
				type: 'boolean',
				default: true,
			},
		};
	}

	static _transform(tree, options) {
		let decoderIdent;
		let key;
		estraverse.traverse(tree, {
			enter(func) {
				if (utils.specMatch(func, {
					type: 'FunctionDeclaration',
				})) {
					estraverse.traverse(func.body, {
						enter(statement) {
							if (utils.specMatch(statement,
								utils.parseStatement('$_Identifier_ += String.fromCharCode($_Identifier_.charCodeAt($_Identifier_) ^ $_Literal_)'))) {
								decoderIdent = func.id.name;
								key = statement.expression.right.arguments[0].right.value;
								return estraverse.VisitorOption.Break;
							}
						}
					});
					if (typeof decoderIdent !== 'undefined') {
						return estraverse.VisitorOption.Break;
					}
				}
			}
		});

		if (typeof decoderIdent === 'undefined') {
			return false;
		}

		let stringMap = {};
		function replacer(node) {
			if (utils.specMatch(node, utils.parseStatement(`function ${decoderIdent}($_Identifier_) {}`))) {
				return estraverse.VisitorOption.Remove;
			} else if (utils.specMatch(node, utils.parseStatement(`var $_Identifier_ = ${decoderIdent}($_Literal_)`))){
				stringMap[node.declarations[0].id.name] = node.declarations[0].init.arguments[0].value.split('').map(x => String.fromCharCode(x.charCodeAt(0) ^ key)).join('');
				return estraverse.VisitorOption.Remove;
			} else if (['BreakStatement', 'ContinueStatement'].indexOf(node.type) !== -1) {
				return estraverse.VisitorOption.Skip;
			} else if (node.type === 'LabeledStatement') {
				estraverse.replace(node.body, {
					enter: replacer,
				});
				return estraverse.VisitorOption.Skip;
			} else if (node.type === 'Identifier' && node.name in stringMap) {
				return {
					type: 'Literal',
					value: stringMap[node.name],
				}
			}
		}
		estraverse.replace(tree, {
			enter: replacer,
		});
		return true;
	}
}
