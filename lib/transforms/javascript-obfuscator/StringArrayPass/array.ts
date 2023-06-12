import * as t from '@babel/types';
import _traverse, { Binding, NodePath } from '@babel/traverse';

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

			const elements = stringArrayPath.get('elements');
			const mapResult = elements.map(
				(elem: NodePath<t.SpreadElement | t.Expression | null>) =>
					elem.isStringLiteral() ? elem.node.value : null
			);
			if (mapResult.every((e): e is string => e !== null)) {
				this.arrayIdentifier = idPath.node.name;
				this.arrayData = mapResult;
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
			const varPath = arrayPath.parentPath;
			if (!varPath?.isVariableDeclarator()) {
				arrayPath.skip();
				return;
			}

			const idPath = varPath.get('id');
			if (!idPath.isIdentifier()) {
				arrayPath.skip();
				return;
			}

			const binding = arrayPath.scope.getBinding(idPath.node.name);
			if (!binding) {
				throw new Error('cannot get binding from scope');
			}

			const elements = arrayPath.get('elements');
			const mapResult = elements.map(
				(elem: NodePath<t.SpreadElement | t.Expression | null>) =>
					elem.isStringLiteral() ? elem.node.value : null
			);
			if (mapResult.every((e): e is string => e !== null)) {
				this.candidates.set(binding, mapResult);
			}

			arrayPath.skip();
		},
	}, state);

	return state.candidates;
}