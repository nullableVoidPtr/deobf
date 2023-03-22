import TargetComposer from './TargetComposer.js';
import * as GlobalWindowPass from '../transforms/yamu/GlobalWindowPass.js';
import * as StringFoldPass from '../transforms/yamu/StringFoldPass.js';
import * as LoopArrayPass from '../transforms/yamu/LoopArrayPass.js';

export default TargetComposer([
	GlobalWindowPass,
	StringFoldPass,
	LoopArrayPass,
]);
