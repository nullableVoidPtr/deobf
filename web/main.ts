import { makeDeobfuscator } from '../src/web.js';
import JavascriptObfuscatorTarget from '../lib/targets/JavascriptObfuscatorTarget';

export const deobfuscate = makeDeobfuscator(JavascriptObfuscatorTarget);