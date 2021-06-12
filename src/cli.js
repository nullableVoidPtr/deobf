import esprima from 'esprima';
import escodegen from 'escodegen';
import fs from 'fs';
import yargs from 'yargs';

export default async (targetName, description) => {
	let target = await (await import(`../lib/targets/${targetName}Target.js`)).default;
	const argv = yargs.usage('$0 <source> [destination]', description ?? 'deobfuscate a file',
		(yargs) => {
			yargs.options(target.yargsOptions)
				.positional('source', {
					type: 'string'
				}).positional('destination', {
					type: 'string'
				});
		}
	).argv;

	let deobfuscatedSource;
	let tree = esprima.parse(fs.readFileSync(argv.source).toString());
	target.deobfuscate(tree, argv);
	deobfuscatedSource = escodegen.generate(tree);

	if (typeof argv.destination === 'undefined') {
		console.log(deobfuscatedSource);
	} else {
		fs.writeFileSync(argv.destination, deobfuscatedSource);
	}
};

