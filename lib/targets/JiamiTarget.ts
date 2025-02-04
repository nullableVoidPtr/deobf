import TargetComposer from './TargetComposer.js';
import * as StringArrayFixupPass from '../transforms/jiami/StringArrayFixupPass.js';
import * as JSOP from '../transforms/jso/mod.js';
import * as BlockStatementPass from '../transforms/BlockStatementPass.js';
import * as ConditionalStatementPass from '../transforms/ConditionalStatementPass.js';
import * as LiteralFoldPass from '../transforms/LiteralFoldPass.js';
import * as SequenceStatementPass from '../transforms/SequenceStatementPass.js';
import * as DotNotationPass from '../transforms/DotNotationPass.js';
import hexIndexer from '../transforms/jiami/StringArrayDecoder.js';
import analyseRotators from '../transforms/jiami/StringArrayRotator.js';

export default TargetComposer([
	BlockStatementPass,
	[SequenceStatementPass, ConditionalStatementPass],
	// JSOP.ControlFlowStoragePass,
	LiteralFoldPass,
	StringArrayFixupPass,
	JSOP.StringArrayPass.withOptions({
		decoder: {
			indexer: hexIndexer,
		},
		rotator: analyseRotators,
	}),
	LiteralFoldPass,
	[
		JSOP.ObjectFoldPass,
		DotNotationPass,
		JSOP.ControlFlowStoragePass,
		LiteralFoldPass,
		JSOP.DeadCodeRemovalPass,
	],
	JSOP.ControlFlowRecoveryPass,
	JSOP.AntiAnalysisRemovalPass,
]);
