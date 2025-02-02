import * as t from '@babel/types';
import * as bq from 'babylon-query';
import { type Binding, type NodePath } from '@babel/traverse';
import { decode as b64decode } from 'base64-arraybuffer';
import { getVarInitId, pathAsBinding } from '../../../utils.js';

export interface DecoderInfo {
	arrayBinding: Binding;
	data: string[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	decoder: (...args: any) => string;
}

const accessorCurry = (array: string[], offset: number) => (index: number | string) =>
	array[Number(index) + offset];
const b64DecCurry = (
	accessor: ReturnType<typeof accessorCurry>,
	alphabet: string
) =>
	(
		(charMap) => (index: number | string) =>
			new TextDecoder().decode(b64decode(
				accessor(index).replace(/[a-zA-Z0-9+/=]/g, (c) => charMap[c]),
			))
	)(
		Object.fromEntries(
			[
				...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
			].map((c, i) => [c, alphabet[i]])
		)
	);
const rc4Curry =
	(b64Dec: ReturnType<typeof b64DecCurry>) =>
		(index: number | string, key?: string) => {
			if (!key) {
				throw new Error('key expected');
			}
			const s = [];
			let j = 0,
				x,
				res = '';
			for (let i = 0; i < 256; i++) {
				s[i] = i;
			}
			for (let i = 0; i < 256; i++) {
				j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
				x = s[i];
				s[i] = s[j];
				s[j] = x;
			}
			let i = 0;
			j = 0;
			const str = b64Dec(index);
			for (let y = 0; y < str.length; y++) {
				i = (i + 1) % 256;
				j = (j + s[i]) % 256;
				x = s[i];
				s[i] = s[j];
				s[j] = x;
				res += String.fromCharCode(
					str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]
				);
			}
			return res;
		};

export default function findDecoders(
	arrayCandidates: Map<Binding, string[]>
): Map<Binding, DecoderInfo> | null {
	const potentialDecoders = new Map<
		Binding,
		{
			arrayBinding: Binding;
			data: string[];
		}
	>();
	for (const [binding, data] of arrayCandidates) {
		for (const reference of binding.referencePaths) {
			const { scope } = reference;
			if (scope.path === binding.path) continue;

			const func = scope.path;
			if (!func.isFunction()) continue;
			const params = func.get('params');
			if (params.length !== 2) continue;
			if (!params.every((p) => p.isIdentifier())) continue;

			let decoderBinding: Binding | null = null;
			if (func.isFunctionDeclaration()) {
				decoderBinding = pathAsBinding(func);
			} else if (func.isFunctionExpression()) {
				const varId = getVarInitId(func);
				if (!varId) continue;

				decoderBinding = pathAsBinding(varId);
			} else {
				continue;
			}

			if (!decoderBinding) {
				throw new Error('cannot get binding from scope');
			}

			potentialDecoders.set(decoderBinding, {
				arrayBinding: binding,
				data,
			});
		}
	}

	if (potentialDecoders.size === 0) {
		console.error('Decoder not found');
		return null;
	}

	const results = new Map<Binding, DecoderInfo>();

	const defaultCharMap =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	for (const [binding, { data, arrayBinding }] of potentialDecoders) {
		let decoderPath = binding.path;
		if (decoderPath.isVariableDeclarator()) {
			const func = decoderPath.get('init');
			if (!func.isFunctionExpression()) {
				throw new Error('decoder with no function');
			}
			decoderPath = func;
		}

		if (!binding.constant) {
			if (binding.constantViolations.length > 1) {
				throw new Error('multiple constant violations');
			}

			const write = binding.constantViolations[0];
			if (!write.isAssignmentExpression({ operator: '=' })) {
				throw new Error('unexpected constant violation');
			}

			const valuePath = write.get('right');
			if (!valuePath.isFunctionExpression()) {
				throw new Error('unexpected constant violation value');
			}

			decoderPath = valuePath;
		}

		if (!decoderPath.isFunction()) {
			throw new Error('decoder with no function');
		}


		const firstArg = decoderPath.get('params')[0];
		if (!firstArg.isIdentifier()) {
			throw new Error('unexpected non-Identifier as first parameter');
		}
		const indexParams = [decoderPath.scope.getOwnBinding(firstArg.node.name)];
		let shift = 0;
		for (const p of indexParams) {
			if (!p) {
				throw new Error('undefined index parameter');
			}

			if (p.constantViolations.length > 1) {
				throw new Error('multiple constant violations');
			}

			const write = p.constantViolations[0];
			if (!write.isAssignmentExpression({ operator: '=' })) {
				throw new Error('unexpected constant violation');
			}

			const valuePath = write.get('right');
			if (!valuePath.isBinaryExpression({ operator: '-' })) {
				throw new Error('unexpected constant violation value');
			}

			const shiftPath = valuePath.get('right');
			if (!shiftPath.isNumericLiteral()) {
				throw new Error('unexpected constant violation value');
			}

			shift = -shiftPath.node.value;
		}

		const state = {
			isBase64: false,
			curry: accessorCurry(
				data,
				shift
			) as (index: number | string, key?: string) => string,
		}
		decoderPath.traverse({
			CallExpression(atobPath: NodePath<t.CallExpression>) {
				if (t.isIdentifier(atobPath.node.callee, { name: 'atob' })) {
					this.curry = b64DecCurry(this.curry, defaultCharMap);
					this.isBase64 = true;
					atobPath.skip();
					return;
				}
			},
			FunctionExpression(atobPath: NodePath<t.FunctionExpression>) {
				if (this.isBase64) return;

				if (!atobPath.parentPath?.isVariableDeclarator()) return;
				atobPath.traverse({
					ConditionalExpression(
						path: NodePath<t.ConditionalExpression>
					) {
						const { node } = path;
						if (!t.isNumericLiteral(node.alternate, { value: 0 })) return;

						const appendSelector = bq.parse(
							`ConditionalExpression:root:has(
								> AssignmentExpression[operator='+='].consequent:has(
									> Identifier.left
								)
							):has(
								> NumericLiteral.alternate[value=0]
							)`
						);
						const appendMatch = bq.matches(
							path,
							appendSelector,
							{},
						);
						if (!appendMatch) return;

						this.isBase64 = true;
						path.stop();
					},
				}, this);

				if (!this.isBase64) return;

				this.isBase64 = false; 
				atobPath.traverse({
					StringLiteral(charMapPath: NodePath<t.StringLiteral>) {
						if (
							!charMapPath.parentPath?.isVariableDeclarator() ||
							charMapPath.node.value == ''
						) return;
						this.curry = b64DecCurry(this.curry, charMapPath.node.value);
						this.isBase64 = true;
						charMapPath.stop();
					},
				}, this);
			},
			BinaryExpression(encryptExprPath: NodePath<t.BinaryExpression>) {
				if (
					!this.isBase64 ||
					encryptExprPath.node.operator != '^' ||
					(!(
						t.isMemberExpression(encryptExprPath.node.right) &&
						t.isBinaryExpression(encryptExprPath.node.right.property, {
							operator: '%',
						})
					) && !(
						t.isMemberExpression(encryptExprPath.node.left) &&
						t.isBinaryExpression(encryptExprPath.node.left.property, {
							operator: '%',
						})
					))
				) return;
				this.curry = rc4Curry(this.curry);
				encryptExprPath.stop();
			},
		}, state);
		results.set(binding, { decoder: state.curry, data, arrayBinding });
	}

	return results;
}

