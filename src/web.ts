import { parse } from '@babel/parser';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { type NodePath } from '@babel/traverse';
import _generate from '@babel/generator';
import { Target } from '../lib/targets/TargetComposer.js';

const traverse = _traverse.default;
const generate = _generate.default;

export function makeDeobfuscator(target: Target) {
	return (source: string) => {
		const tree = parse(source);
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

		return deobfuscatedSource;
	};
}