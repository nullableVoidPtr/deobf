import * as t from "@babel/types";
import * as bq from "babylon-query";
import { Binding, NodePath } from "@babel/traverse";
import * as vm from "vm";
import { inlineProxyCall } from "../../utils.js";
import LiteralFoldPass from "../LiteralFoldPass.js";

interface DecoderInfo {
	arrayBinding: Binding;
	data: string[];
	decoder: (...args: any) => string;
}

const accessorCurry = (array: string[], offset: number) => (index: number) =>
	array[Number(index) + offset];
const b64DecCurry = (
	accessor: ReturnType<typeof accessorCurry>,
	alphabet: string
) =>
	(
		(charMap) => (index: number) =>
			Buffer.from(
				accessor(index).replace(/[a-zA-Z0-9+/=]/g, (c) => charMap[c]),
				"base64"
			).toString("utf8")
	)(
		Object.fromEntries(
			[
				..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
			].map((c, i) => [c, alphabet[i]])
		)
	);
const rc4Curry =
	(b64Dec: ReturnType<typeof b64DecCurry>) =>
	(index: number, key?: string) => {
		if (!key) {
			throw new Error("key expected");
		}
		let s = [],
			j = 0,
			x,
			res = "";
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
		let str = b64Dec(index);
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

function analyseStringArrayFunction(
	funcDecl: NodePath<t.FunctionDeclaration>
): [Binding, string[]] | null {
	let identifier: string | null = null;
	let array: string[] | null = null;
	let isStringArrayFunction = false;
	const funcDeclIdPath = funcDecl.get("id");
	if (!funcDeclIdPath.isIdentifier()) {
		return null;
	}
	funcDecl.traverse({
		ArrayExpression(path: NodePath<t.ArrayExpression>) {
			if (identifier) return;

			const { parentPath } = path;
			if (!parentPath.isVariableDeclarator()) return path.skip();

			const idPath = parentPath.get("id");
			if (!idPath.isIdentifier()) return path.skip();

			const elements = path.get("elements");
			const mapResult = elements.map(
				(elem: NodePath<t.SpreadElement | t.Expression | null>) =>
					elem.isStringLiteral() ? elem.node.value : null
			);
			if (mapResult.every((e): e is string => e !== null)) {
				identifier = idPath.node.name;
				array = mapResult;
			}

			return path.skip();
		},
		AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
			if (!identifier) return;
			const left = path.get("left");
			if (!left.isIdentifier({ name: funcDeclIdPath.node.name }))
				return path.skip();
			isStringArrayFunction = true;

			return path.stop();
		},
	});

	if (!isStringArrayFunction) return null;
	if (!identifier) return null;
	if (!array) return null;

	return [funcDecl.scope.getBinding(funcDeclIdPath.node.name)!, array];
}

function findStringArrayCandidates(path: NodePath): Map<Binding, string[]> {
	const candidates = new Map<Binding, string[]>();
	path.traverse({
		FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
			let stringArrayFunction = analyseStringArrayFunction(path);
			if (stringArrayFunction !== null) {
				const [binding, arr] = stringArrayFunction;
				candidates.set(binding, arr);
				return path.skip();
			}
		},
		ArrayExpression(path: NodePath<t.ArrayExpression>) {
			let identifier: string | null = null;

			const { parentPath } = path;
			if (!parentPath.isVariableDeclarator()) {
				return path.skip();
			}

			const idPath = parentPath.get("id");
			if (!idPath.isIdentifier()) {
				return path.skip();
			}

			identifier = idPath.node.name;

			const elements = path.get("elements");
			const mapResult = elements.map(
				(elem: NodePath<t.SpreadElement | t.Expression | null>) =>
					elem.isStringLiteral() ? elem.node.value : null
			);
			if (mapResult.every((e): e is string => e !== null)) {
				candidates.set(path.scope.getBinding(identifier)!, mapResult);
			}

			return path.skip();
		},
	});

	return candidates;
}

function findDecoders(
	path: NodePath,
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
			if (scope.path === binding.path) {
				continue;
			}

			if (!scope.path.isFunctionDeclaration()) {
				continue;
			}

			const func: NodePath<t.FunctionDeclaration> = scope.path;
			const params = func.get("params");
			if (params.length !== 2 || !params.every((p) => p.isIdentifier())) {
				continue;
			}

			const idPath = func.get("id");
			if (!idPath.isIdentifier()) {
				continue;
			}
			potentialDecoders.set(scope.getBinding(idPath.node.name)!, {
				arrayBinding: binding,
				data,
			});
		}
	}

	if (potentialDecoders.size === 0) {
		console.error("Decoder not found");
		return null;
	}

	const results = new Map<Binding, DecoderInfo>();

	const defaultCharMap =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
	for (const [binding, { data, arrayBinding }] of potentialDecoders) {
		let path = binding.path as NodePath<t.Function>;
		path.assertFunction();

		if (!binding.constant) {
			if (binding.constantViolations.length > 1) {
				throw new Error("multiple constant violations");
			}

			const write = binding.constantViolations[0];
			if (!write.isAssignmentExpression({ operator: "=" })) {
				throw new Error("unexpected constant violation");
			}

			const valuePath = write.get("right");
			if (!valuePath.isFunctionExpression()) {
				throw new Error("unexpected constant violation value");
			}

			path = valuePath;
		}

		const firstArg = path.get("params")[0];
		if (!firstArg.isIdentifier()) {
			throw new Error("unexpected non-Identifier as first parameter");
		}
		let indexParams = [path.scope.getOwnBinding(firstArg.node.name)];
		let shift = 0;
		for (const p of indexParams) {
			if (p == null) {
				throw new Error("undefined index parameter");
			}

			if (p.constantViolations.length > 1) {
				throw new Error("multiple constant violations");
			}

			const write = p.constantViolations[0];
			if (!write.isAssignmentExpression({ operator: "=" })) {
				throw new Error("unexpected constant violation");
			}

			const valuePath = write.get("right");
			if (!valuePath.isBinaryExpression({ operator: "-" })) {
				throw new Error("unexpected constant violation value");
			}

			const shiftPath = valuePath.get("right");
			if (!shiftPath.isNumericLiteral()) {
				throw new Error("unexpected constant violation value");
			}

			shift = -shiftPath.node.value;
		}

		let isBase64 = false;
		let curry: (index: number, key?: string) => string = accessorCurry(
			data,
			shift
		);
		path.traverse({
			CallExpression(path: NodePath<t.CallExpression>) {
				if (t.isIdentifier(path.node.callee, { name: "atob" })) {
					curry = b64DecCurry(curry, defaultCharMap);
					isBase64 = true;
					return path.skip();
				}
			},
			FunctionExpression(path: NodePath<t.FunctionExpression>) {
				if (!path.parentPath.isVariableDeclarator()) {
					return;
				}
				path.traverse({
					ConditionalExpression(
						path: NodePath<t.ConditionalExpression>
					) {
						const { node } = path;
						if (!t.isNumericLiteral(node.alternate, { value: 0 })) {
							return;
						}

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
						if (!appendMatch) {
							return;
						}

						isBase64 = true;
						return path.stop();
					},
				});
				if (!isBase64) {
					return;
				}

				path.traverse({
					StringLiteral(path: NodePath<t.StringLiteral>) {
						if (
							!path.parentPath.isVariableDeclarator() ||
							path.node.value == ""
						) {
							return;
						}
						curry = b64DecCurry(curry, path.node.value);
						path.stop();
					},
				});
			},
			BinaryExpression(path: NodePath<t.BinaryExpression>) {
				if (
					!isBase64 ||
					path.node.operator != "^" ||
					!t.isMemberExpression(path.node.right) ||
					!t.isBinaryExpression(path.node.right.property, {
						operator: "%",
					})
				) {
					return;
				}
				curry = rc4Curry(curry);
				return path.stop();
			},
		});
		results.set(binding, { decoder: curry, data, arrayBinding });
	}

	return results;
}

function resolveWrappers(path: NodePath, decoders: Binding[]) {
	for (const decoder of decoders) {
		const callRefPathStack = [...decoder.referencePaths];
		while (callRefPathStack.length > 0) {
			const callRefPath = callRefPathStack.pop()!;
			const refAncestry = callRefPath.getAncestry();
			if (callRefPath.key === "init") {
				const binding = callRefPath.scope.getOwnBinding(
					(<t.VariableDeclarator & { id: t.Identifier }>(
						callRefPath.parent
					)).id.name
				);
				if (binding?.constant) {
					for (const wrapperRef of binding.referencePaths) {
						wrapperRef.replaceWith(decoder.identifier);
						decoder.reference(wrapperRef);
						callRefPathStack.push(wrapperRef);
					}

					const refIndex = decoder.referencePaths.indexOf(callRefPath);
					if (refIndex !== -1) {
						decoder.referencePaths.splice(refIndex, 1);
						decoder.dereference();
					}
					binding.path.remove();
					binding.scope.removeBinding(binding.identifier.name);
				}
			} else if (callRefPath.key === "callee") {
				if (refAncestry.length < 3) {
					continue;
				}
				if (!refAncestry[2].isReturnStatement()) {
					continue;
				}

				const proxyPath = callRefPath.scope.path; //refPath.ancestry
				let proxyId: string | null = null;
				let proxyFunc: NodePath<t.Function> | null = null;
				if (proxyPath.isFunctionDeclaration()) {
					proxyId = proxyPath.node.id?.name || null;
					proxyFunc = proxyPath;
					if (!proxyId) {
						throw new Error("call wrapper without identifier");
					}
				} else if (proxyPath.isFunctionExpression()) {
					const { parentPath } = proxyPath;
					if (parentPath.isVariableDeclarator() && proxyPath.key == "init") {
						const idPath = parentPath.get('id');
						if (idPath.isIdentifier()) {
							proxyId = idPath.node.name;
						}
						proxyFunc = proxyPath;
					}
				}

				if (proxyId == null || proxyFunc == null) {
					throw new Error("unexpected call wrapper");
				}

				const binding = proxyPath.parentPath?.scope.getOwnBinding(
					proxyId
				);

				if (binding?.constant) {
					for (const wrapperRef of binding.referencePaths) {
						if (wrapperRef.key !== "callee") {
							throw new Error(
								"unexpected reference to wrapper"
							);
						}
						const wrapperCall =
							wrapperRef.parentPath as NodePath<t.CallExpression>;
						const args = wrapperCall.node.arguments;
						if (
							!args.every((a): a is t.Expression =>
								t.isExpression(a)
							)
						) {
							throw new Error("unexpected call args");
						}
						inlineProxyCall(wrapperCall, proxyFunc, args);
						LiteralFoldPass(wrapperCall);
						decoder.reference(wrapperCall.get("callee"));
						callRefPathStack.push(wrapperCall.get("callee"));
					}

					const refIndex = decoder.referencePaths.indexOf(callRefPath);
					if (refIndex !== -1) {
						decoder.referencePaths.splice(refIndex, 1);
						decoder.dereference();
					}
					binding.path.remove();
					binding.scope.removeBinding(binding.identifier.name);
				}
			}
		}
	}
}

function analyseRotators(path: NodePath, decoders: Map<Binding, DecoderInfo>) {
	path.traverse({
		CallExpression(path: NodePath<t.CallExpression>) {
			const args = path.get("arguments");
			if (
				args.length !== 2 ||
				!args[0].isIdentifier() ||
				!args[1].isNumericLiteral()
			) {
				return;
			}
			const [arrayRefArg, expectedValueArg] = args;
			const arrayRefId = arrayRefArg.node.name;
			let associatedDecoder: DecoderInfo | null = null;
			for (const d of decoders.values()) {
				if (arrayRefId == d.arrayBinding.identifier.name) {
					associatedDecoder = d;
					break;
				}
			}
			if (associatedDecoder == null) {
				return;
			}
			let isRotatePredicate = (
				expression: NodePath<t.Expression>
			): boolean => {
				if (expression.isLiteral()) {
					return true;
				}

				if (expression.isBinaryExpression()) {
					const left = expression.get("left");
					const right = expression.get("right");
					if (!left.isExpression() || !right.isExpression()) {
						return false;
					}

					return isRotatePredicate(left) && isRotatePredicate(right);
				}

				if (expression.isUnaryExpression()) {
					return isRotatePredicate(expression.get("argument"));
				}

				const parseIntSelector = bq.parse(
					`CallExpression[arguments.length=1]:root:has(
						> Identifier.callee[name='parseInt']
					):has(
						> CallExpression.arguments.0:has(
							> Identifier.callee
						)
					)`
				);
				const parseIntMatch = bq.matches(
					expression,
					parseIntSelector,
					{},
				);

				return parseIntMatch;
			};
			let expression: NodePath<t.Expression>;
			path.traverse({
				VariableDeclarator(path) {
					const init = path.get("init");
					if (!init.isExpression() || !isRotatePredicate(init)) {
						return;
					}
					expression = init;
					path.stop();
				},
			});
			//TODO Identify decoders this way and analyse
			if (decoders === null) {
				throw Error("Iterative rotator without decoder found");
			}
			if (expression! == null) {
				throw Error("Cannot find validator expression");
			}
			const evalExpression = expression.toString();
			let script = new vm.Script(evalExpression);
			let vmContext: Record<string, any> = {};
			for (const [{ identifier }, { decoder }] of decoders) {
				vmContext[identifier.name] = decoder;
			}
			const context = vm.createContext(vmContext);
			const array = associatedDecoder.data;

			for (let offset = 0; offset < array.length; offset++) {
				try {
					const calculatedValue = script.runInContext(context);
					if (expectedValueArg.node.value == calculatedValue) {
						for (const [binding, _] of decoders) {
							for (const reference of binding.referencePaths) {
								if (path.isAncestor(reference)) {
									const refIndex = binding.referencePaths.indexOf(reference);
									if (refIndex !== -1) {
										binding.referencePaths.splice(refIndex, 1);
										binding.dereference();
									}
								}
							}
						}
						path.remove();
						break;
					}
				} catch (scriptError) {}
				array.push(array.shift()!);
			}
			path.skip();
		},
	});
}

export default (path: NodePath): boolean => {
	const candidates = findStringArrayCandidates(path);
	if (candidates === null) {
		return false;
	}

	const decoders = findDecoders(path, candidates);
	if (decoders === null) {
		return false;
	}
	resolveWrappers(path, [...decoders.keys()]);
	analyseRotators(path, decoders);

	for (const [binding, { arrayBinding }] of decoders) {
		if (!arrayBinding.path.removed) {
			arrayBinding.path.remove();
			arrayBinding.scope.removeBinding(arrayBinding.identifier.name);
		}

		for (const [otherBinding, _] of decoders) {
			for (const reference of [...binding.referencePaths]) {
				if (otherBinding.path.isAncestor(reference)) {
					const refIndex = binding.referencePaths.indexOf(reference);
					if (refIndex !== -1) {
						binding.referencePaths.splice(refIndex, 1);
						binding.dereference();
					}
				}
			}
		}
		binding.path.remove();
		binding.scope.removeBinding(binding.identifier.name);
	}

	for (const [decoderBinding, { decoder }] of decoders) {
		for (const decoderRef of decoderBinding.referencePaths) {
			if (decoderRef.key !== "callee") {
				continue;
			}

			const { parentPath } = decoderRef;
			if (!parentPath?.isCallExpression()) {
				continue;
			}

			const args: any[] = [];
			for (const literal of parentPath.get("arguments")) {
				const state = literal.evaluate();
				if (state.confident) {
					args.push(state.value);
				} else {
					throw new Error("unexpected arg in call to decoder");
				}
			}
			parentPath.replaceWith(t.stringLiteral(decoder(...args)));
		}
	}

	return true;
};
