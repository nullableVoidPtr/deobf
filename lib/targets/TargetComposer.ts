import { NodePath } from "@babel/traverse";

type PassSpec = (string | PassSpec)[];

type BasePass = {
	transform: (path: NodePath) => boolean;
	repeatUntilStable: boolean;
	name: string;
};

type Pass = BasePass | Pass[];

function processPasses(passes: PassSpec): Promise<Pass[]> {
	return Promise.all(
		passes.map((pass) =>
			Array.isArray(pass)
				? processPasses(pass)
				: typeof pass === "string"
				? import(`../transforms/${pass}.js`).then((module) => ({
						transform: module.default,
						repeatUntilStable: module.repeatUntilStable,
						name: pass,
				  }))
				: pass
		)
	);
}

function callPass(pass: BasePass, path: NodePath) {
	/*
	let enabler = Object.entries(pass.yargsOptions || {}).find(([_, option]) => option.enabler)?.[0];
	if (enabler in options && !options[enabler]) {
		return false;
	}

	if ('isEnabled' in pass && !pass.isEnabled(options)) {
		return false;
	}
	*/

	const result = pass.transform(path);
	path.scope.crawl();
	return result;
}

interface Target {
	deobfuscate(path: NodePath): void;
}

export default async (passes: PassSpec): Promise<Target> => {
	const processed = await processPasses(passes);
	return {
		deobfuscate(path: NodePath) {
			for (let pass of processed) {
				let repeat;
				do {
					repeat = false;
					if (Array.isArray(pass)) {
						for (let subpass of <BasePass[]>pass) {
							repeat = callPass(subpass, path) || repeat;
						}
					} else {
						repeat = callPass(pass, path) && pass.repeatUntilStable;
					}
				} while (repeat);
			}
		},
	};
};
