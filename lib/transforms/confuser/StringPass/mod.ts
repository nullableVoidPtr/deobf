import { type NodePath } from '@babel/traverse';
import Base91Pass from './Base91Pass.js';
import DecompressPass from './DecompressPass.js';

export default (path: NodePath) => {
	let changed = false;

	changed = DecompressPass(path) || changed;
	changed = Base91Pass(path) || changed;

	return changed;
}