import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import { getVarInitId, pathAsBinding } from '../../../utils.js';

function evalStringArrayChecked(path: NodePath<t.ArrayExpression>) {
	const strings: string[] = [];
	
	for (const element of path.get('elements')) {
		if (!element.isStringLiteral()) return null;

		strings.push(element.node.value);
	}

	return strings;
}

function analyseStringArrayFunction(
	funcDecl: NodePath<t.FunctionDeclaration>
): [Binding, string[]] | null {
	const funcDeclIdPath = funcDecl.get('id');
	if (!funcDeclIdPath.isIdentifier()) {
		return null;
	}

	const state: {
		arrayIdentifier?: string;
		arrayData?: string[];
		isStringArrayFunction?: boolean;
	} = {};

	funcDecl.traverse({
		ArrayExpression(stringArrayPath) {
			if (this.arrayIdentifier) return;

			const varDeclPath = stringArrayPath.parentPath;
			if (!varDeclPath?.isVariableDeclarator()) {
				stringArrayPath.skip();
				return;
			}

			const idPath = varDeclPath.get('id');
			if (!idPath.isIdentifier()) {
				stringArrayPath.skip();
				return;
			}

			const strings = evalStringArrayChecked(stringArrayPath);
			if (strings) {
				this.arrayIdentifier = idPath.node.name;
				this.arrayData = strings;
			}

			stringArrayPath.skip();
		},
		AssignmentExpression(assignPath) {
			if (!this.arrayIdentifier) return;
			const left = assignPath.get('left');
			if (!left.isIdentifier({ name: funcDeclIdPath.node.name })) {
				assignPath.skip();
				return;
			}
			this.isStringArrayFunction = true;

			assignPath.stop();
		},
	}, state);

	if (!state.isStringArrayFunction) return null;
	if (!state.arrayIdentifier) return null;
	if (!state.arrayData) return null;

	const binding = funcDecl.scope.getBinding(funcDeclIdPath.node.name);
	if (!binding) {
		return null;
	}

	return [binding, state.arrayData];
}

export default function findStringArrayCandidates(treePath: NodePath): Map<Binding, string[]> {
	const state = {
		candidates: new Map<Binding, string[]>(),
	};

	treePath.traverse({
		FunctionDeclaration(stringArrayFuncPath) {
			const stringArrayFunction = analyseStringArrayFunction(stringArrayFuncPath);
			if (stringArrayFunction !== null) {
				const [binding, arr] = stringArrayFunction;
				this.candidates.set(binding, arr);
				stringArrayFuncPath.skip();
			}
		},
		ArrayExpression(arrayPath) {
			const id = getVarInitId(arrayPath);
			if (!id) {
				arrayPath.skip();
				return;
			}

			const binding = pathAsBinding(id);
			if (!binding) {
				throw new Error('cannot get binding from scope');
			}

			const strings = evalStringArrayChecked(arrayPath);
			if (strings) {
				this.candidates.set(binding, strings);
			}

			arrayPath.skip();
		},
	}, state);

	return state.candidates;
}