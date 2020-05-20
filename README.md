# `deobf`
Deobfuscator targetting `javascript-obfuscator@0.28.0`
## DISCLAIMER
This is a hacky project I made over a week, and was mostly a messy exercise in AST analysis and transformations, while also being my first
node.js project.
I have achieved source recovery with some small samples, however I wouldn't trust any output to be executable and 1:1 with larger inputs.
For the most part, the output is meant to be a supplement to reverse-engineering the original sample
Use at your own peril.
## Usage
```
index.js <source> [destination]

deobfuscate a Javascript Obfuscator obfuscated file

Positionals:
  source                                                                [string]
  destination                                                           [string]

Options:
  --help                           Show help                           [boolean]
  --version                        Show version number                 [boolean]
  --string-array-pass                                  [boolean] [default: true]
  --string-obfuscation, -s
          [string] [choices: "auto", "array", "base64", "rc4"] [default: "auto"]
  --string-rotation, -r                                                 [number]
  --control-flow-storage-pass                          [boolean] [default: true]
  --dead-code-removal-pass                             [boolean] [default: true]
  --control-flow-recovery-pass                         [boolean] [default: true]
  --debug-protection-removal-pass                      [boolean] [default: true]
  --debug-protection-function                                           [string]
  --console-enable-pass                                [boolean] [default: true]
  --self-defense-removal-pass                          [boolean] [default: true]
  --domain-lock-removal-pass                           [boolean] [default: true]
  --call-controller-removal-pass                       [boolean] [default: true]
```
