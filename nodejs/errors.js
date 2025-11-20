class DomainError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

class SidemailLocalError extends DomainError {
	constructor(message) {
		super(message);
	}
}

class SidemailApiError extends DomainError {
	constructor({ developerMessage, errorCode, moreInfo }) {
		super(developerMessage);

		this.developerMessage = developerMessage;
		this.errorCode = errorCode;
		this.moreInfo = moreInfo;
	}
}

module.exports = {
	SidemailLocalError,
	SidemailApiError,
};
