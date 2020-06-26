module.exports = passes => ({
	yargsOptions: Object.assign({}, ...passes.map(pass => pass.yargsOptions)),
	deobfuscate(tree, options) {
		for (let pass of passes) {
			let repeat;
			do {
				repeat = false;
				if (Array.isArray(pass)) {
					for (let subpass of pass) {
						repeat = subpass.transform(tree, options) || repeat;
					}
				} else {
					repeat = pass.transform(tree, options) && pass.repeatUntilStable;
				}
			} while (repeat);
		}
	},
});
