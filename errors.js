class SidemailError extends Error {
	constructor(message, { httpStatus, errorCode, moreInfo } = {}) {
		super(message);
		this.name = "SidemailError";
		this.errorCode = errorCode;
		this.moreInfo = moreInfo;
		this.httpStatus = httpStatus;
	}
}

module.exports = { SidemailError };
