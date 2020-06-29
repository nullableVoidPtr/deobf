import estraverse from 'estraverse';
import utils from '../../utils.js';

export const yargsOptions = {
	'string-literal-pass': {
		type: 'boolean',
		default: true,
	},
}, isEnabled = (options) => options.stringLiteralPass;

export default (tree, options) => {
	let decoderIdent = null;
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
				if (decoderIdent) {
					return estraverse.VisitorOption.Break;
				}
			}
		}
	});

	if (!decoderIdent) {
		return false;
	}

	let stringMap = {};
	estraverse.replace(tree, {
		enter(node) {
			if (utils.specMatch(node, utils.parseStatement(`function ${decoderIdent}($_Identifier_) {}`))) {
				return estraverse.VisitorOption.Remove;
			} else if (utils.specMatch(node, utils.parseStatement(`var $_Identifier_ = ${decoderIdent}($_Literal_)`))){
				stringMap[node.declarations[0].id.name] = node.declarations[0].init.arguments[0].value.split('').map(x => String.fromCharCode(x.charCodeAt(0) ^ key)).join('');
				return estraverse.VisitorOption.Remove;
			} else if (['BreakStatement', 'ContinueStatement'].indexOf(node.type) !== -1) {
				return estraverse.VisitorOption.Skip;
			} else if (node.type === 'LabeledStatement') {
				estraverse.replace(node.body, {
					enter: this.visitor.enter,
				});
				return estraverse.VisitorOption.Skip;
			} else if (node.type === 'Identifier' && node.name in stringMap) {
				return {
					type: 'Literal',
					value: stringMap[node.name],
				}
			}
		},
	});
	return true;
}
