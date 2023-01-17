import TargetComposer from "./TargetComposer.js";

export default await TargetComposer([
	"BlockStatementPass",
	["SequenceStatementPass", "ConditionalStatementPass"],
	"javascript-obfuscator/ControlFlowStoragePass",
	"LiteralFoldPass",
	"javascript-obfuscator/StringArrayPass",
	"LiteralFoldPass",
	"javascript-obfuscator/ObjectFoldPass",
	"DotNotationPass",
	"javascript-obfuscator/ControlFlowStoragePass",
	"LiteralFoldPass",
	"javascript-obfuscator/DeadCodeRemovalPass",
	"javascript-obfuscator/ControlFlowRecoveryPass",
	"javascript-obfuscator/AntiAnalysisRemovalPass",
]);
