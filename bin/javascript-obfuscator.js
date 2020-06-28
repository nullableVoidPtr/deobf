#!/usr/bin/env node
import cli from '../src/cli.js';
import target from '../lib/targets/JavascriptObfuscatorTarget.js';

target.then(t => cli(t, 'deobfuscate a file obfuscated by Javascript Obfuscator'));

