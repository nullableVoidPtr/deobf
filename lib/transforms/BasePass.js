module.exports = class {
	static get yargOptions() {
		return {};
	}
	static isEnabled(options) {
		return true;
	}
	static _transform(tree, options) {
		throw `Unimplemented _transform for ${this.name}`;
	}
	static transform(tree, options) {
		return this.isEnabled(options) ? this._transform(tree, options) : tree;
	}
}
