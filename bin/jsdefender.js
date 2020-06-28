#!/usr/bin/env node
import cli from '../src/cli.js';
import target from '../lib/targets/JSDefenderTarget.js';

target.then(t => cli(t, 'deobfuscate a JSDefender obfuscated file'));

