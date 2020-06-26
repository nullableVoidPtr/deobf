#!/usr/bin/env node

require('../src/cli.js')(
	require('../lib/targets/JSDefenderTarget.js'),
	'deobfuscate a JSDefender obfuscated file');

