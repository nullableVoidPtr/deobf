#!/usr/bin/env node
import cli from '../src/cli.js';
import JavascriptObfuscatorTarget from '../lib/targets/JavascriptObfuscatorTarget.js';

cli(
	JavascriptObfuscatorTarget,
	'deobfuscate a file obfuscated by Javascript Obfuscator'
);
