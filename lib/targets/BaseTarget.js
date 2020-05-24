module.exports = class BaseTarget {
	static get yargsOptions() {
		return Object.assign({}, ...this.passes.map(pass => pass.yargsOptions))
	}

	static get passes() {
		throw `No passes for ${this.name}`;
	}

	static deobfuscateESTree(tree, options) {
		for (let pass of this.passes) {
			let transformed = false;
			do {
				transformed = pass.transform(tree, options);
			} while (pass.repeatUntilStable && transformed);
		}
	}
}
