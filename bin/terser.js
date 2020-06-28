#!/usr/bin/env node
import cli from '../src/cli.js';
import target from '../lib/targets/TerserTarget.js';

target.then(t => cli(t, 'deobfuscate a Terser minified file'));

