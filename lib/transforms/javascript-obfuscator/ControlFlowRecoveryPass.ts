import * as t from '@babel/types';
import { NodePath } from '@babel/traverse';
import * as bq from 'babylon-query';
import { dereferencePathFromBinding } from '../../utils.js';

const dispatcherSelector = bq.parse(
	`WhileStatement:has(
		> Literal.test
	)
	> BlockStatement.body
	> SwitchStatement
	> MemberExpression.discriminant:has(> UpdateExpression.property > Identifier.argument)
	> Identifier.object`
);

export default (path: NodePath): boolean => {
	let controlFlowRecovered = false;
	const execOrderMatches = <NodePath<t.VariableDeclarator>[]>(
		bq.query(
			path,
			`VariableDeclarator:has(
				> Identifier.id
			):has(
				> CallExpression.init:has(
					> StringLiteral.arguments.0
				)
				> MemberExpression.callee:has(
					> Identifier.property[name='split']
				)
				> StringLiteral.object
			)`
		)
	);
	for (const match of execOrderMatches) {
		const orderBinding = match.scope.getBinding(
			(<t.Identifier>match.node.id).name
		);
		if (!orderBinding) {
			throw new Error('cannot get binding for control flow');
		}

		const evalState = match.get('init').evaluate();
		if (!evalState.confident) {
			throw new Error('cannot evaluate execution order');
		}
		const execOrder = evalState.value;

		for (const orderRef of [...orderBinding.referencePaths]) {
			const dispatcherMatched = bq.matches(
				orderRef,
				dispatcherSelector,
				{}
			);
			if (!dispatcherMatched) {
				throw new Error('unexpected dispatcher structure');
			}
			const ancestry = orderRef.getAncestry();
			const loop = ancestry.find(
				(p): p is NodePath<t.WhileStatement> => p.isWhileStatement()
			);
			if (!loop) {
				throw new Error('unexpected dispatcher structure');
			}

			const loopBlock = loop.get('body');
			if (!loopBlock.isBlockStatement()) {
				throw new Error('unexpected dispatcher structure');
			}

			const loopBody = loopBlock.get('body');

			const switcherIndex = loopBody.findIndex(
				(p): p is NodePath<t.SwitchStatement> => p.isSwitchStatement()
			);
			if (switcherIndex === -1) {
				throw new Error('cannot find switch statement');
			}
			const switcher = <NodePath<t.SwitchStatement>>(
				loopBody[switcherIndex]
			);
			const statementsBefore = loopBody.slice(0, switcherIndex);
			const statementsAfter = loopBody.slice(switcherIndex + 1);
			const breakIdx = statementsAfter.findIndex((p) =>
				p.isBreakStatement()
			);
			statementsAfter.splice(breakIdx);

			const execOrderMemberExpr = ancestry.find(
				(p): p is NodePath<t.MemberExpression> => p.isMemberExpression()
			);
			if (!execOrderMemberExpr) {
				throw new Error('unexpected dispatcher structure');
			}

			const counterId = (<NodePath<t.Identifier>>(
				(<NodePath<t.UpdateExpression>>(
					execOrderMemberExpr.get('property')
				)).get('argument')
			)).node.name;
			const counterBinding = match.scope.getBinding(counterId);
			if (!counterBinding) {
				throw new Error('cannot find counter binding');
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const cases = new Map<any, NodePath<t.Statement>[]>();
			for (const c of switcher.get('cases')) {
				const test = c.get('test');
				if (!test.isExpression()) {
					throw new Error('unexpected default case');
				}
				const evalState = test.evaluate();
				if (!evalState.confident) {
					throw new Error('cannot evaluate switch case test');
				}
				const consequent = c.get('consequent');
				const continueIdx = consequent.findIndex((p) =>
					p.isContinueStatement()
				);
				cases.set(
					evalState.value,
					c.get('consequent').slice(0, continueIdx)
				);
			}
			const newStatements = [];
			for (const caseIndex of execOrder) {
				const selected = cases.get(caseIndex);
				if (!selected) {
					throw new Error(
						'cannot resolve statements for a case'
					);
				}
				newStatements.push(...statementsBefore);
				newStatements.push(...selected);
				newStatements.push(...statementsAfter);
			}

			loop.replaceWithMultiple(newStatements.map((p) => p.node));
			dereferencePathFromBinding(orderBinding, orderRef);
			orderBinding.path.remove();
			orderBinding.scope.removeBinding(orderBinding.identifier.name);
			counterBinding.path.remove();
			counterBinding.scope.removeBinding(counterBinding.identifier.name);
			controlFlowRecovered = true;
		}
	}

	return controlFlowRecovered;
};
