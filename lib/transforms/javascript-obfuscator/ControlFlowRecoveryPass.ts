import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";
import * as bq from "babylon-query";

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
	path.traverse({
		Scopable(path) {
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
				if (orderBinding == null) {
					throw new Error("cannot get binding for control flow");
				}

				const evalState = match.get("init").evaluate();
				if (!evalState.confident) {
					throw new Error("cannot evaluate execution order");
				}
				const execOrder = evalState.value;

				for (const orderRef of orderBinding.referencePaths) {
					const dispatcherMatched = bq.matches(
						orderRef,
						dispatcherSelector,
						{}
					);
					if (!dispatcherMatched) {
						throw new Error("unexpected dispatcher structure");
					}
					const ancestry = orderRef.getAncestry();
					const loop = <NodePath<t.WhileStatement>>(
						ancestry.find((p) => p.isWhileStatement())
					);
					const loopBody = (<NodePath<t.BlockStatement>>(
						loop.get("body")
					)).get("body");

					const switcherIndex = loopBody.findIndex((p) =>
						p.isSwitchStatement()
					);
					if (switcherIndex === -1) {
						throw new Error("cannot find switch statement");
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

					const counterId = (<NodePath<t.Identifier>>(
						(<NodePath<t.UpdateExpression>>(
							ancestry
								.find((p) => p.isMemberExpression())!
								.get("property")
						)).get("argument")
					)).node.name;
					const counterBinding = match.scope.getBinding(counterId)!;

					const cases = new Map<any, NodePath<t.Statement>[]>();
					for (const c of switcher.get("cases")) {
						const test = c.get("test");
						if (!test.isExpression()) {
							throw new Error("unexpected default case");
						}
						const evalState = test.evaluate();
						if (!evalState.confident) {
							throw new Error("cannot evaluate switch case test");
						}
						const consequent = c.get("consequent");
						const continueIdx = consequent.findIndex((p) =>
							p.isContinueStatement()
						);
						cases.set(
							evalState.value,
							c.get("consequent").slice(0, continueIdx)
						);
					}
					const newStatements = [];
					for (const caseIndex of execOrder) {
						const selected = cases.get(caseIndex);
						if (selected == null) {
							throw new Error(
								"cannot resolve statements for a case"
							);
						}
						newStatements.push(...statementsBefore);
						newStatements.push(...selected);
						newStatements.push(...statementsAfter);
					}

					loop.replaceWithMultiple(newStatements.map((p) => p.node));
					orderBinding.path.remove();
					counterBinding.path.remove();
					controlFlowRecovered = true;
				}
			}
		},
	});

	return controlFlowRecovered;
};
