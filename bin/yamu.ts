#!/usr/bin/env node
import YamuObfuscatorTarget from '../lib/targets/YamuObfuscatorTarget.js';
import cli from '../src/cli.js';

cli(
	YamuObfuscatorTarget,
	'deobfuscate a file obfuscated'
);
