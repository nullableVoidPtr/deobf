#!/usr/bin/env node
import cli from '../src/cli.js';
import ConfuserTarget from '../lib/targets/ConfuserTarget.js';

cli(
	ConfuserTarget,
	'deobfuscate a file'
);
