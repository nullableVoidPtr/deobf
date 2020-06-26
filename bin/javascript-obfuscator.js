#!/usr/bin/env node

require('../src/cli.js')(
	require('../lib/targets/JavascriptObfuscatorTarget.js'),
	'deobfuscate a file obfuscated by Javascript Obfuscator');

