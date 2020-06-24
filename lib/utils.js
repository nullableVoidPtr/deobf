const esprima = require('esprima');
const estraverse = require('estraverse');

let parseCache = {};
function parseStatement(string) {
	if (!(string in parseCache)) {
		parseCache[string] = estraverse.replace(esprima.parse(string).body[0], {
			enter(node) {
				if (node.type === 'Literal' && 'raw' in node) {
					delete node.raw;
					return;
				}

				if (node.type === 'Identifier' && node.name.startsWith('$')) {
					if (node.name.startsWith('$$')) {
						node.name = node.name.substring(1);
						return;
					}
					if (node.name.startsWith('$_') && node.name.endsWith('_')) {
						if (node.name === '$_IGNORE_') {
							return estraverse.VisitorOption.Remove;
						}
						return {
							type: node.name.substr(2, node.name.length - 3)
						}
					}
					throw `Unescaped marker identifier ${node.name}`
				}
			},
			leave(node) {
				for ([key, value] of Object.entries(node)) {
					if (value === null) {
						delete node[key];
					}
				}
			}
		});
	}
	return parseCache[string];
}

module.exports = {
	removeEmptyVarDecls(tree) {
		estraverse.replace(tree, {
			enter: (node) => {
				if (node.type === 'VariableDeclaration' &&
					node.declarations.length === 0) {
					return estraverse.VisitorOption.Remove;
				}
			}
		});
	},
	escapeIdentifier(identifier) {
		if (identifier.startsWith('$')) {
			return '$' + identifier;
		}
		return identifier;
	},
	parseStatement: parseStatement,
	parseExpression(string) {
		return parseStatement(string).expression;
	},
	specMatch: function specMatch(node, spec) {
		return Object.entries(spec).every(([key, value]) => {
			if (!(key in node)) {
				return false;
			}
			if (value instanceof Object &&
				node[key] instanceof Object) {
				return specMatch(node[key], value);
			}
			return value === node[key];
		})
	},
	isValidIdentifier(identifier) {
		const reservedKeywords = [
			'break', 'do', 'instanceof', 'typeof',
			'case', 'else', 'new', 'var',
			'catch', 'finally', 'return', 'void',
			'continue', 'for', 'switch', 'while',
			'debugger', 'if', 'throw', 'delete',
			'in', 'try', 'class', 'enum',
			'extends', 'super', 'const', 'export',
			'import', 'implements', 'let', 'private',
			'public', 'interface', 'package', 'protected',
			'static', 'yield', 'null', 'true',
			'false',
		];
		const validVarNameRegex = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;

		return !reservedKeywords.includes(identifier) &&
			validVarNameRegex.test(identifier);
	},
	isLoopStatement(node) {
		const LoopStatements = [
			'DoWhileStatement',
			'ForStatement',
			'ForInStatement',
			'ForOfStatement',
			'WhileStatement'
		];
		return LoopStatements.includes(node.type)
	},
	modifyScope(scope, mutator = () => {}, filter = () => true, discriminator = null) {
		const ScopeBodyMap = {
			'Program': ['body'],
			'BlockStatement': ['body'],
			'WithStatement': ['body'],
			'LabeledStatement': ['body'],
			'IfStatement': ['consequent', 'alternate'],
			'SwitchCase': ['consequent'],
			'WhileStatement': ['body'],
			'DoWhileStatement': ['body'],
			'ForStatement': ['body'],
			'ForInStatement': ['body'],
			'ForOfStatement': ['body'],
		};

		if (!(scope.type in ScopeBodyMap)) {
			return;
		}

		for (let body of ScopeBodyMap[scope.type].map(key => scope[key]).filter(o => o !== null)) {
			if (Array.isArray(body)) {
				if (discriminator) {
					let finalised = new Set();
					let index;
					while (index = body.findIndex(node => filter(node) && !finalised.has(discriminator(node)))) {
						let node = body[index];
						finalised.add(discriminator(node));
						mutator(node, index, body);
					}
				} else {
					let index = body.length;
					while (index--) {
						let node = body[index]
						if (!filter(node)) {
							continue;
						}
						mutator(node, index, body);
					}
				}
			} else if (filter(body)) {
				mutator(body, -1, null);
			}
		}
	},
}
