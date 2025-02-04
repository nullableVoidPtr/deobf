#!/usr/bin/env node
import cli from '../src/cli.js';
import JiamiTarget from '../lib/targets/JiamiTarget.js';

cli(
	JiamiTarget,
	'deobfuscate a file'
);
