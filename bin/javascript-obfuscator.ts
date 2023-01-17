#!/usr/bin/env node
import cli from "../src/cli.js";

void (await cli(
	"JavascriptObfuscator",
	"deobfuscate a file obfuscated by Javascript Obfuscator"
));
