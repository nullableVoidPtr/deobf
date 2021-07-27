import acorn from 'acorn';
import estraverse from 'estraverse';

let parseCache = {};

export function removeEmptyVarDecls(tree) {
	estraverse.replace(tree, {
		enter(node) {
			if (node.type === 'VariableDeclaration' &&
				node.declarations.length === 0) {
				return estraverse.VisitorOption.Remove;
			}
		}
	});
}

export function escapeIdentifier(identifier) {
	return (identifier.startsWith('$') ? '$' : '') + identifier;
}
export function parseStatement(string) {
	if (!(string in parseCache)) {
		parseCache[string] = estraverse.replace(acorn.parse(string).body[0], {
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
						let newNode = {
							type: node.name.substr(2, node.name.length - 3)
						};
						let match = newNode.type.match(/^(.+)\$(\d+)$/);
						if (match) {
							newNode.type = match[1];
							newNode.__ordinal__ = Number(match[2]);
						}
						return newNode;
					}
					throw Error(`Unescaped marker identifier ${node.name}`);
				}
			},
			leave(node) {
				for (let [key, value] of Object.entries(node)) {
					if (['start', 'end'].includes(key) || value === null) {
						delete node[key];
					}
				}
			}
		});
	}
	return parseCache[string];
}
export function parseExpression(string) {
	return this.parseStatement(string).expression;
}
function _specMatch(node, spec, matches) {
	for (let [key, value] of Object.entries(spec)) {
		if (node === null || typeof node === 'undefined') {
			return null;
		} else if (key == '__ordinal__') {
			if (value == 0) {
				throw Error('Cannot use 0 as an ordinal');
			}
			matches[value] = node;
		} else if (!(key in node)) {
			return null;
		} else if (value instanceof Object &&
			node[key] instanceof Object) {
			let innerMatches = _specMatch(node[key], value, {});
			if (!innerMatches) {
				return null;
			}
			for (let [innerKey, innerValue] of Object.entries(innerMatches)) {
				if (innerKey in matches) {
					if (innerValue.type != 'Identifier') {
						throw Error('Only Identifiers can have clashing ordinals.');
					} else if (innerValue.name != matches[innerKey].name) {
						return null;
					}
				} else {
					matches[innerKey] = innerValue;
				}
			}
		} else if (value !== node[key]) {
			return null;
		}
	}
	return matches;
}
export function specMatch(node, spec) {
	let matches = _specMatch(node, spec, {0: node});
	if (!matches) {
		return false;
	}
	matches = Object.entries(matches).sort(([lOrd, _l], [rOrd, _r]) => lOrd - rOrd);
	let prev = -1;
	for (let [ordinal, _] of matches) {
		ordinal -= 0;
		if (ordinal !== prev + 1) {
			throw Error('Inconsistent ordinals');
		}
		prev = ordinal;
	}
	return matches.map(([_, node]) => node);
}
export function isValidIdentifier(identifier) {
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
}
export function isLoopStatement(node) {
	const LoopStatements = [
		'DoWhileStatement',
		'ForStatement',
		'ForInStatement',
		'ForOfStatement',
		'WhileStatement'
	];
	return LoopStatements.includes(node.type);
}
export function modifyScope(scope, mutator = () => {}, filter = () => true, discriminator = null) {
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
				let tags;
				while ((index = body.findIndex(node => filter(node) &&
					(Array.isArray(tags = discriminator(node)) ?
						tags.some(t => !finalised.has(t)) :
						!finalised.has(tags)))) !== -1) {
					let node = body[index];
					if (Array.isArray(tags)) {
						for (let t of tags) {
							finalised.add(t);
						}
					} else {
						finalised.add(tags);
					}
					mutator(node, index, body);
				}
			} else {
				let index = body.length;
				while (index--) {
					let node = body[index];
					if (filter(node)) {
						mutator(node, index, body);
					}
				}
			}
		} else if (filter(body)) {
			mutator(body, -1, null);
		}
	}
}
