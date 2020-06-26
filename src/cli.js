const esprima = require('esprima');
const escodegen = require('escodegen');
const fs = require('fs');

const yargs = require('yargs')

module.exports = (target, description) => {
	const argv = yargs.usage('$0 <source> [destination]', description || 'deobfuscate a file',
		(yargs) => {
			yargs.options(target.yargsOptions)
			.positional('source', {
				type: 'string'
			}).positional('destination', {
				type: 'string'
			})
		}
	).argv;

	let tree = esprima.parse(fs.readFileSync(argv.source).toString());
	target.deobfuscate(tree, argv);
	let deobfuscatedSource = escodegen.generate(tree);
	if (typeof argv.destination === 'undefined') {
		console.log(deobfuscatedSource);
	} else {
		fs.writeFileSync(argv.destination, deobfuscatedSource);
	}
}

