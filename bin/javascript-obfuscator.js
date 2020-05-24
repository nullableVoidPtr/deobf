#!/usr/bin/env node

const esprima = require('esprima');
const JavascriptObfuscatorTarget = require('../lib/targets/JavascriptObfuscatorTarget.js');
const escodegen = require('escodegen');
const fs = require('fs');

const argv = require('yargs')
	.usage('$0 <source> [destination]', 'deobfuscate a Javascript Obfuscator obfuscated file',
		(yargs) => {
			yargs.options(JavascriptObfuscatorTarget.yargsOptions)
			.positional('source', {
				type: 'string'
			}).positional('destination', {
				type: 'string'
			})
		}
	).argv;

let tree = esprima.parse(fs.readFileSync(argv.source).toString());
JavascriptObfuscatorTarget.deobfuscateESTree(tree, argv);
let deobfuscatedSource = escodegen.generate(tree);
if (typeof argv.destination === 'undefined') {
	console.log(deobfuscatedSource);
} else {
	fs.writeFileSync(argv.destination, deobfuscatedSource);
}

