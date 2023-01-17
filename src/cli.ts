import { parse } from "@babel/parser";
import generate from "@babel/generator";
import * as t from "@babel/types";
import traverse, { NodePath } from "@babel/traverse";
import { readFile, writeFile } from "fs/promises";
import yargs from "yargs";

export default async (targetName: string, description: string) => {
	const target = (await import(`../lib/targets/${targetName}Target.js`))
		.default;
	const argv = await yargs(process.argv.slice(2))
		.usage("$0 <source> [destination]", description ?? "deobfuscate a file")
		.parse();

	const tree = parse(await readFile(argv.source as string, "utf8"));
	(<typeof traverse>(<any>traverse).default)(tree, {
		Program(path: NodePath<t.Program>) {
			target.deobfuscate(path);
			return path.stop();
		},
	});
	const deobfuscatedSource = (<typeof generate>(<any>generate).default)(
		tree
	).code;

	if (typeof argv.destination === "undefined") {
		console.log(deobfuscatedSource);
	} else {
		await writeFile(argv.destination as string, deobfuscatedSource, "utf8");
	}
};
