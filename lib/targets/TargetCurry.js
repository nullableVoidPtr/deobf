function processPasses(passes) {
	return Promise.all(passes.map(pass => Array.isArray(pass) ? processPasses(pass) :
		(typeof pass === 'string' ? import(`../transforms/${pass}.js`) : pass)));
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
							if ('isEnabled' in subpass && !subpass.isEnabled(options)) {
								continue;
							}
							repeat = subpass.default(tree, options) || repeat;
						}
					} else {
						if ('isEnabled' in pass && !pass.isEnabled(options)) {
							continue;
						}
						repeat = pass.default(tree, options) && pass.repeatUntilStable;
					}
				} while (repeat);
			}
		},
	}
};
