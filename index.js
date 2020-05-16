#!/usr/bin/env node

const esprima = require('esprima');
const {yargsOptions, deobfuscateESTree} = require('./lib');
const escodegen = require('escodegen');
const fs = require('fs');

const argv = require('yargs')
	.usage('$0 <source> [destination]', 'deobfuscate a Javascript Obfuscator obfuscated file',
		(yargs) => {
			yargs.options(yargsOptions)
			.positional('source', {
				type: 'string'
			}).positional('destination', {
				type: 'string'
			})
		}
	).argv;

let tree = esprima.parse(fs.readFileSync(argv.source).toString());
tree = deobfuscateESTree(tree, argv);
console.log(escodegen.generate(tree));

