# Introduction
At a high-level, `deobf` is focuses on AST-AST deobfuscation; generally speaking that entails two sub-problems:
* Detection
* Transformation

# Program structure
deobf has multiple "targets" to deobfuscate, focusing on a specific obfuscator; the only maintained target is the one for JavaScript Obfuscator, however, as deobf is a framework, more targets, potentially with specialised passes, can be implemented.

## Targets
A target is a sequence of passes, specified in `lib/targets/` using the `TargetComposer` function; an example, the `TerserTarget`, is illustrated below:
```js
import TargetComposer from './TargetComposer.js';

export default await TargetComposer([
	'BooleanPass',
	'terser/StatementDelineationPass',
	[
		'terser/SequenceStatementPass',
		'terser/ConditionalStatementPass',
	],
]);
```

The only argument passed to `TargetComposer` is a nested array of passes. Each pass can be specified to be repeated until there are no changes, useful for something like `LiteralFoldPass`. Likewise, a sub-array is treated like a pass itself, where the inner array is repeated until there were no changes to the AST.

## Passes
Passes are implemented in `lib/transforms/`.

A pass can be specified to be repeated until the AST is unchanging by exporting a constant:
```js
export const repeatUntilStable = true
```
Passes generally make use of the `estraverse.replace` function, which traverses the AST and can replace nodes.

Generally speaking, detection is done using `estraverse.traverse`, and transformations are done using `estraverse.replace`.
