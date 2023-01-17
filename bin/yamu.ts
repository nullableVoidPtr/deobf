#!/usr/bin/env node
import cli from "../src/cli.js";

void (await cli('YamuObfuscator', 'deobfuscate a file obfuscated by Javascript Obfuscator'));
