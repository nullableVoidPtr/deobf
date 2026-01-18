import * as t from '@babel/types';
import { type Binding, type NodePath } from '@babel/traverse';
import globalLogger, { getPassName } from '../../logging.js';
import { getPropertyName, pathAsBinding } from '../../utils.js';

export default (path: NodePath): boolean => {
	let changed = false;

	const logger = globalLogger.child({
		'pass': getPassName(import.meta.url),
	});
	logger.debug('Starting...');

	path.traverse({
		FunctionDeclaration(shuffleFunc) {
			if (shuffleFunc.node.body.body.length !== 2) return;

			const params = shuffleFunc.get('params');
			if (params.length < 2) return;

			let arrayParam: Binding | null = null;
			let offsetParam: Binding | null = null;

			for (const binding of Object.values(shuffleFunc.scope.bindings)) {
				if (binding.path == params[0] && !arrayParam) {
					arrayParam = binding;
				} else if (binding.path == params[1] && !offsetParam) {
					offsetParam = binding;
				}
			}

			if (!arrayParam || !offsetParam) return;

			if (!arrayParam.referencePaths.some(ref => ref.parentPath?.isReturnStatement())) return;
			if (!arrayParam.referencePaths.some(
				ref => ref.parentPath?.isMemberExpression() && ref.key === 'object' && getPropertyName(ref.parentPath) === 'push'
			)) return;
			if (!arrayParam.referencePaths.some(
				ref => ref.parentPath?.isMemberExpression() && ref.key === 'object' && getPropertyName(ref.parentPath) === 'shift'
			)) return;

			if (!offsetParam.referencePaths.some(ref => ref.parentPath?.isBinaryExpression() && (
				(ref.parentPath.node.operator === '<' && ref.key === 'right') ||
				(ref.parentPath.node.operator === '>' && ref.key === 'left')
			))) return;

			const binding = pathAsBinding(shuffleFunc);
			if (!binding) return;

			function fixShuffle(ref: NodePath) {
				const call = ref.parentPath;
				if (!call?.isCallExpression() || ref.key !== 'callee') return false;

				const args = call.get('arguments');
				if (args.length < 2) return false;

				const arrayArg = args[0];
				const offsetArg = args[1];

				if (!offsetArg.isNumericLiteral()) return false;

				if (arrayArg.isIdentifier()) {
					const arrayBinding = pathAsBinding(arrayArg);
					if (!arrayBinding?.constant || arrayBinding.references !== 1) return false;

					const resolvedArray = arrayArg.resolve();
					if (!resolvedArray.isArrayExpression()) return false;					

					arrayArg.replaceWith(resolvedArray.node);
					if (!arrayArg.isArrayExpression()) return false;
				} else if (!arrayArg.isArrayExpression()) {
					return false;
				}

				const elements = arrayArg.node.elements
				const arrayLength = elements.length;
				const offset = offsetArg.node.value % arrayLength;

				call.replaceWith(
					t.arrayExpression(
						elements.slice(offset, arrayLength).concat(elements.slice(0, offset))
					)
				);
				changed = true;
				return true;
			}

			let missed = false;
			for (const ref of binding.referencePaths) {
				missed = !fixShuffle(ref) || missed;
			}

			if (!missed) {
				shuffleFunc.remove();
				changed = true;
			}
		}
	});

	logger.info('Done' + (changed ? ' with changes' : ''));

	return changed;
}