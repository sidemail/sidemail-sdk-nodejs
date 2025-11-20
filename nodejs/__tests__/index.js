const fetch = require("node-fetch");
jest.mock("node-fetch");
const { Response } = jest.requireActual("node-fetch");

const configureSidemail = require("../");

function makeMockedResponse() {
	return Promise.resolve(
		new Response(JSON.stringify({ is: "ok" }), {
			headers: new Headers({ "Content-Type": "application/json" }),
		})
	);
}

test("Configures", () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	expect(sidemail.apiKey).toBe("123");
	expect(sidemail.host).toBe("https://api.sidemail.io");
});

test("Returns API URL", () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	expect(sidemail.getApiUrl("email/send")).toBe(
		"https://api.sidemail.io/v1/email/send"
	);
});

test("Performs API request", async () => {
	fetch.mockReturnValue(makeMockedResponse());
	const payload = { some: "payload" };
	const sidemail = configureSidemail({ apiKey: "123" });
	const response = await sidemail.performApiRequest("path", payload);

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(fetch).toHaveBeenCalledWith(
		"https://api.sidemail.io/v1/path",
		expect.objectContaining({
			body: JSON.stringify(payload),
			method: "POST",
			headers: expect.objectContaining({
				Authorization: "Bearer 123",
				Accept: "application/json",
				"Content-Type": "application/json",
			}),
		})
	);
	expect(response.is).toBe("ok");
});

test("Sends email", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.performApiRequest = jest.fn(() => Promise.resolve({ is: "ok" }));

	const payload = { fromAddress: "marry@lightning.com" };
	const response = await sidemail.sendEmail(payload);
	expect(response.is).toBe("ok");
	expect(sidemail.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.performApiRequest).toHaveBeenCalledWith(
		"email/send",
		expect.objectContaining(payload)
	);
});

test("Sends email backward compatible", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.sendEmail = jest.fn(() => Promise.resolve({ is: "ok" }));

	const payload = { fromAddress: "marry@lightning.com" };
	const response = await sidemail.sendMail(payload);
	expect(response.is).toBe("ok");
	expect(sidemail.sendEmail).toHaveBeenCalledTimes(1);
	expect(sidemail.sendEmail).toHaveBeenCalledWith(
		expect.objectContaining(payload)
	);
});

test("Creates or updates a contact", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	const payload = { emailAddress: "marry@lightning.com" };
	const response = await sidemail.contacts.createOrUpdate(payload);
	expect(response.is).toBe("ok");
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		"contacts",
		expect.objectContaining(payload)
	);
});

test("Find a contact", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	const args = { emailAddress: "marry@lightning.com" };
	const response = await sidemail.contacts.find(args);
	expect(response.is).toBe("ok");
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		`contacts/${args.emailAddress}`,
		null,
		expect.objectContaining({ method: "GET" })
	);
});

test("List contacts", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	const response = await sidemail.contacts.list();
	expect(response.is).toBe("ok");
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		`contacts?`,
		null,
		expect.objectContaining({ method: "GET" })
	);
});

test("List contacts pagination", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	const response = await sidemail.contacts.list({
		paginationCursorNext: "123",
	});
	expect(response.is).toBe("ok");
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		`contacts?paginationCursorNext=123`,
		null,
		expect.objectContaining({ method: "GET" })
	);
});

test("Delete a contact", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	const args = { emailAddress: "marry@lightning.com" };
	const response = await sidemail.contacts.delete(args);
	expect(response.is).toBe("ok");
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		`contacts/${args.emailAddress}`,
		null,
		expect.objectContaining({ method: "DELETE" })
	);
});