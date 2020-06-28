export default class {
	static get yargOptions() {
		return {};
	}
	static isEnabled(options) {
		return true;
	}
	static get repeatUntilStable() {
		return false;
	}
	static _transform(tree, options) {
		throw `Unimplemented _transform`;
	}
	static transform(tree, options) {
		return this.isEnabled(options) ? this._transform(tree, options) : false;
	}
};
