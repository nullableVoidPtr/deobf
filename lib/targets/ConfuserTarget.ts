import TargetComposer from './TargetComposer.js';
import * as ConfuserPasses from '../transforms/confuser/mod.js';
import * as ConditionalStatementPass from '../transforms/ConditionalStatementPass.js';
import * as BlockStatementPass from '../transforms/BlockStatementPass.js';
import * as DotNotationPass from '../transforms/DotNotationPass.js';
import * as LiteralFoldPass from '../transforms/LiteralFoldPass.js';

export default TargetComposer([
	ConfuserPasses.UnpackFunctionPass,
	BlockStatementPass,
	ConfuserPasses.ASTDescramblePass,
	[ConditionalStatementPass],
	ConfuserPasses.UnhoistPass,
	// ConfuserPasses.UnflattenControlFlowPass,
	ConfuserPasses.UnshuffleArrayPass,
	LiteralFoldPass,
	ConfuserPasses.LiteralOutliningPass,
	LiteralFoldPass,
	DotNotationPass,
	ConfuserPasses.UnmaskVariablePass,
	ConfuserPasses.StringPass,
	LiteralFoldPass,
	DotNotationPass,
	ConfuserPasses.GlobalObjectPass,
	ConfuserPasses.CalculatorInlinePass,
	ConfuserPasses.DummyFunctionPass,
	LiteralFoldPass,
	DotNotationPass,
	ConfuserPasses.DeadCodeRemovalPass,
	ConfuserPasses.OutlineDispatchPass,
	ConfuserPasses.LiftEvalFunctionsPass,
	ConfuserPasses.UnmaskVariablePass,
	[ConfuserPasses.UnflattenFunctionPass],
]);