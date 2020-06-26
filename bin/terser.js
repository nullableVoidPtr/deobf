#!/usr/bin/env node

require('../src/cli.js')(
	require('../lib/targets/TerserTarget.js'),
	'deobfuscate a Terser minified file');

