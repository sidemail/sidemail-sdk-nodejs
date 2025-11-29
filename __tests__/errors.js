const { SidemailError } = require("../errors");

describe("SidemailError", () => {
	test("Sets error details for API errors", () => {
		const error = new SidemailError("Invalid parameters", {
			httpStatus: 400,
			errorCode: "parameters-invalid",
			moreInfo: "http://sidemail.io/docs",
		});
		expect(error.name).toBe("SidemailError");
		expect(error.message).toBe("Invalid parameters");
		expect(error.httpStatus).toBe(400);
		expect(error.errorCode).toBe("parameters-invalid");
		expect(error.moreInfo).toBe("http://sidemail.io/docs");
	});

	test("Works with just a message", () => {
		const error = new SidemailError("Something went wrong");
		expect(error.name).toBe("SidemailError");
		expect(error.message).toBe("Something went wrong");
		expect(error.httpStatus).toBeUndefined();
		expect(error.errorCode).toBeUndefined();
	});
});
