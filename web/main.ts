import { makeDeobfuscator } from '../src/web.js';
import JSOTarget from '../lib/targets/JSOTarget.js';

export const deobfuscate = makeDeobfuscator(JSOTarget);