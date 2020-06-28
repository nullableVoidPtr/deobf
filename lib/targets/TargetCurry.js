export default async passes => {
	passes = await Promise.all(passes);
	return {
		yargsOptions: Object.assign({}, ...passes.flatMap(pass => pass.default.yargsOptions)),
		deobfuscate(tree, options) {
			for (let pass of passes) {
				let repeat;
				do {
					repeat = false;
					if (Array.isArray(pass)) {
						for (let subpass of pass) {
							repeat = subpass.default.transform(tree, options) || repeat;
						}
					} else {
						repeat = pass.default.transform(tree, options) && pass.repeatUntilStable;
					}
				} while (repeat);
			}
		},
	}
};
