class SidemailError extends Error {
	constructor(message, { httpStatus, errorCode, moreInfo, cause } = {}) {
		super(message);
		this.name = "SidemailError";
		this.errorCode = errorCode;
		this.moreInfo = moreInfo;
		this.httpStatus = httpStatus;
		if (cause) {
			this.cause = cause;
		}
	}
}

module.exports = { SidemailError };
