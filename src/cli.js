import acorn from 'acorn';
import { generate } from 'astring';
import fs from 'fs';
import yargs from 'yargs';

export default async (targetName, description) => {
	let target = (await import(`../lib/targets/${targetName}Target.js`)).default;
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
	let tree = acorn.parse(fs.readFileSync(argv.source).toString(), {ecmaVersion: 2020});
	target.deobfuscate(tree, argv);
	deobfuscatedSource = generate(tree);

	if (typeof argv.destination === 'undefined') {
		console.log(deobfuscatedSource);
	} else {
		fs.writeFileSync(argv.destination, deobfuscatedSource);
	}
};

