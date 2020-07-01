function processPasses(passes) {
	return Promise.all(passes.map(pass => Array.isArray(pass) ? processPasses(pass) :
		(typeof pass === 'string' ? import(`../transforms/${pass}.js`) : pass)));
}

function callPass(pass, tree, options) {
	let enabler = Object.entries(pass.yargsOptions || {}).find(([_, option]) => option.enabler)?.[0];
	if (enabler in options && !options[enabler]) {
		return false;
	}

	if ('isEnabled' in pass && !pass.isEnabled(options)) {
		return false;
	}

	return pass.default(tree, options);
}

export default async passes => {
	passes = await processPasses(passes);
	return {
		yargsOptions: Object.assign({}, ...passes.flat().map(pass => pass.yargsOptions)),
		deobfuscate(tree, options) {
			for (let pass of passes) {
				let repeat;
				do {
					repeat = false;
					if (Array.isArray(pass)) {
						for (let subpass of pass) {
							repeat = callPass(subpass, tree, options) || repeat;
						}
					} else {
						repeat = callPass(pass, tree, options) && pass.repeatUntilStable;
					}
				} while (repeat);
			}
		},
	};
};
