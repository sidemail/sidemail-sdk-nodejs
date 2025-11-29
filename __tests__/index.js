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
		Promise.resolve({
			data: [{ id: 1 }],
			hasMore: false,
			paginationCursorNext: null,
		})
	);

	const result = await sidemail.contacts.list();
	expect(result.data).toEqual([{ id: 1 }]);
	expect(result.hasMore).toBe(false);
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
		Promise.resolve({
			data: [{ id: 2 }],
			hasMore: true,
			paginationCursorNext: "456",
		})
	);

	const result = await sidemail.contacts.list({
		paginationCursorNext: "123",
	});
	expect(result.data).toEqual([{ id: 2 }]);
	expect(result.hasMore).toBe(true);
	expect(result.paginationCursorNext).toBe("456");
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

test("Auto-pagination with autoPaginateEach", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });

	// Mock three pages of results
	sidemail.contacts.performApiRequest = jest
		.fn()
		.mockResolvedValueOnce({
			data: [{ id: 1 }, { id: 2 }],
			hasMore: true,
			paginationCursorNext: "cursor2",
		})
		.mockResolvedValueOnce({
			data: [{ id: 3 }, { id: 4 }],
			hasMore: true,
			paginationCursorNext: "cursor3",
		})
		.mockResolvedValueOnce({
			data: [{ id: 5 }],
			hasMore: false,
			paginationCursorNext: null,
		});

	const result = await sidemail.contacts.list();
	const collected = [];

	await result.autoPaginateEach((contact) => {
		collected.push(contact);
	});

	expect(collected).toEqual([
		{ id: 1 },
		{ id: 2 },
		{ id: 3 },
		{ id: 4 },
		{ id: 5 },
	]);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(3);
});

test("Auto-pagination with async iterator", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });

	// Mock two pages of results
	sidemail.contacts.performApiRequest = jest
		.fn()
		.mockResolvedValueOnce({
			data: [{ id: 1 }, { id: 2 }],
			hasMore: true,
			paginationCursorNext: "cursor2",
		})
		.mockResolvedValueOnce({
			data: [{ id: 3 }],
			hasMore: false,
			paginationCursorNext: null,
		});

	const result = await sidemail.contacts.list();
	const collected = [];

	for await (const contact of result) {
		collected.push(contact);
	}

	expect(collected).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(2);
});

test("Auto-pagination for email.search", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });

	// Mock two pages of results
	sidemail.email.performApiRequest = jest
		.fn()
		.mockResolvedValueOnce({
			data: [{ id: "email1" }, { id: "email2" }],
			hasMore: true,
			paginationCursorNext: "cursor2",
		})
		.mockResolvedValueOnce({
			data: [{ id: "email3" }],
			hasMore: false,
			paginationCursorNext: null,
		});

	const result = await sidemail.email.search({
		query: { status: "delivered" },
	});
	const collected = [];

	for await (const email of result) {
		collected.push(email);
	}

	expect(collected).toEqual([
		{ id: "email1" },
		{ id: "email2" },
		{ id: "email3" },
	]);
	expect(sidemail.email.performApiRequest).toHaveBeenCalledTimes(2);
});

test("fileToAttachment encodes a Buffer to base64 and sets name", () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	const buffer = Buffer.from("hello world");
	const attachment = sidemail.fileToAttachment("test.txt", buffer);
	expect(attachment).toEqual({
		name: "test.txt",
		content: buffer.toString("base64"),
	});
});
