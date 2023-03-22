import { NodePath } from '@babel/traverse';

type BasePass = {
	default: (path: NodePath) => boolean;
	repeatUntilStable?: boolean;
};

export type PassSpec = (BasePass | PassSpec)[];

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

	const result = pass.default(path);
	path.scope.crawl();
	return result;
}

export interface Target {
	spec: PassSpec;
	deobfuscate(path: NodePath): void;
}

export default (passes: PassSpec): Target => {
	return {
		spec: passes,
		deobfuscate(path: NodePath) {
			for (let passIndex = 0; passIndex < passes.length; passIndex++) {
				const pass = passes[passIndex];
				let repeat;
				do {
					repeat = false;
					if (Array.isArray(pass)) {
						for (const subpass of <BasePass[]>pass) {
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
