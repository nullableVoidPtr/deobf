import { parse } from '@babel/parser';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { type NodePath } from '@babel/traverse';
import _generate from '@babel/generator';
import { readFileSync, writeFileSync } from 'node:fs';
import yargs from 'yargs';
import { Target } from '../lib/targets/TargetComposer.js';

// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const traverse: typeof _traverse = (_traverse as any).default;
// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const generate: typeof _generate = (_generate as any).default;

export default (target: Target, description: string) => {
	const argv = yargs(process.argv.slice(2))
		.usage('$0 <source> [destination]', description ?? 'deobfuscate a file')
		.parseSync();

	const tree = parse(readFileSync(argv.source as string, 'utf8'));
	const state: { path: NodePath<t.Program> | null } = { path: null }
	traverse(tree, {
		Program(path: NodePath<t.Program>) {
			this.path = path;
			path.stop();
		},
	}, undefined, state);

	if (!state.path) {
		throw new Error('could not initialise node path')
	}
	target.deobfuscate(state.path);

	const deobfuscatedSource = generate(
		tree
	).code;

	if (typeof argv.destination === 'undefined') {
		console.log(deobfuscatedSource);
	} else {
		writeFileSync(argv.destination as string, deobfuscatedSource, 'utf8');
	}
};
