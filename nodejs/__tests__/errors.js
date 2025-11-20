const { SidemailApiError, SidemailLocalError } = require("../errors");

describe("API error", () => {
	test("Sets error details", () => {
		const errorDetails = {
			developerMessage: "Invalid paramaters",
			errorCode: "paramaters-invalid",
			moreInfo: "http://sidemail.io/docs",
		};
		const error = new SidemailApiError(errorDetails);
		expect(error.name).toBe("SidemailApiError");
		expect(error.developerMessage).toBe(errorDetails.developerMessage);
		expect(error.message).toBe(errorDetails.developerMessage);
		expect(error.errorCode).toBe(errorDetails.errorCode);
		expect(error.moreInfo).toBe(errorDetails.moreInfo);
	});
});

describe("Local error", () => {
	test("Sets error details", () => {
		const error = new SidemailLocalError("Error!");
		expect(error.name).toBe("SidemailLocalError");
		expect(error.message).toBe("Error!");
	});
});