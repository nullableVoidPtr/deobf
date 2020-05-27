module.exports = class BaseTarget {
	static get yargsOptions() {
		return Object.assign({}, ...this.passes.map(pass => pass.yargsOptions))
	}

	static get passes() {
		throw `No passes for ${this.name}`;
	}

	static deobfuscateESTree(tree, options) {
		for (let pass of this.passes) {
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
	}
}
