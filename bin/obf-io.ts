#!/usr/bin/env node
import cli from '../src/cli.js';
import JSOTarget from '../lib/targets/JSOTarget.js';

cli(
	JSOTarget,
	'deobfuscate a file'
);
