const configureSidemail = require("../");

const originalFetch = global.fetch;

beforeEach(() => {
	global.fetch = jest.fn();
});

afterEach(() => {
	global.fetch = originalFetch;
});

function makeMockedResponse() {
	return Promise.resolve({
		headers: { get: () => "application/json" },
		status: 200,
		ok: true,
		json: () => Promise.resolve({ is: "ok" }),
	});
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
	global.fetch.mockReturnValue(makeMockedResponse());
	const payload = { some: "payload" };
	const sidemail = configureSidemail({ apiKey: "123" });
	const response = await sidemail.performApiRequest("path", payload);

	expect(global.fetch).toHaveBeenCalledTimes(1);
	expect(global.fetch).toHaveBeenCalledWith(
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

test("Does not configure custom connection behavior", async () => {
	global.fetch.mockReturnValue(makeMockedResponse());
	const sidemail = configureSidemail({ apiKey: "123" });

	await sidemail.performApiRequest("path", {});

	expect(global.fetch.mock.calls[0][1]).not.toHaveProperty("agent");
	expect(global.fetch.mock.calls[0][1].headers).not.toHaveProperty(
		"Connection"
	);
});

test("Allows a custom fetch implementation", async () => {
	const fetch = jest.fn().mockReturnValue(makeMockedResponse());
	const sidemail = configureSidemail({ apiKey: "123", fetch });

	await sidemail.performApiRequest("path", {});

	expect(fetch).toHaveBeenCalledTimes(1);
	expect(global.fetch).not.toHaveBeenCalled();
});

test("Passes transport fetch options without overriding SDK request values", async () => {
	global.fetch.mockReturnValue(makeMockedResponse());
	const dispatcher = {};
	const sidemail = configureSidemail({
		apiKey: "123",
		fetchOptions: {
			dispatcher,
			redirect: "manual",
			signal: AbortSignal.timeout(1),
			method: "GET",
			body: "custom body",
			headers: {
				Authorization: "Bearer custom",
				"X-Trace-Id": "trace-123",
			},
		},
	});

	await sidemail.performApiRequest("path", { some: "payload" });

	const options = global.fetch.mock.calls[0][1];
	expect(options.dispatcher).toBe(dispatcher);
	expect(options.redirect).toBe("manual");
	expect(options).not.toHaveProperty("signal");
	expect(options.method).toBe("POST");
	expect(options.body).toBe(JSON.stringify({ some: "payload" }));
	expect(options.headers).toEqual(
		expect.objectContaining({
			Authorization: "Bearer 123",
		})
	);
	expect(options.headers).not.toHaveProperty("X-Trace-Id");
});

test("Does not pass fetch option body when SDK request has no body", async () => {
	global.fetch.mockReturnValue(makeMockedResponse());
	const sidemail = configureSidemail({
		apiKey: "123",
		fetchOptions: {
			body: "custom body",
			method: "POST",
		},
	});

	await sidemail.email.get("email-id");

	const options = global.fetch.mock.calls[0][1];
	expect(options.method).toBe("GET");
	expect(options).not.toHaveProperty("body");
});

test("Passes per-call signal", async () => {
	global.fetch.mockReturnValue(makeMockedResponse());
	const controller = new AbortController();
	const sidemail = configureSidemail({ apiKey: "123" });

	await sidemail.email.send(
		{ toAddress: "test@example.com" },
		{ signal: controller.signal }
	);

	expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
});

test("Wraps fetch failures in SidemailError", async () => {
	const originalError = new Error("Premature close");
	global.fetch.mockRejectedValue(originalError);
	const sidemail = configureSidemail({ apiKey: "123" });

	await expect(sidemail.performApiRequest("path", {})).rejects.toMatchObject({
		name: "SidemailError",
		message: "Sidemail API request failed.",
		cause: originalError,
	});
});

test("Wraps response body read failures in SidemailError", async () => {
	const originalError = new Error("Invalid response body: Premature close");
	global.fetch.mockResolvedValue({
		headers: { get: () => "application/json" },
		status: 200,
		ok: true,
		json: jest.fn().mockRejectedValue(originalError),
	});
	const sidemail = configureSidemail({ apiKey: "123" });

	await expect(sidemail.performApiRequest("path", {})).rejects.toMatchObject({
		name: "SidemailError",
		message: "Sidemail API response body could not be read.",
		httpStatus: 200,
		cause: originalError,
	});
});

test("Includes status for unexpected response content type", async () => {
	global.fetch.mockResolvedValue({
		headers: { get: () => "text/html" },
		status: 502,
		ok: false,
		json: jest.fn(),
	});
	const sidemail = configureSidemail({ apiKey: "123" });

	await expect(sidemail.performApiRequest("path", {})).rejects.toMatchObject({
		name: "SidemailError",
		message: "Sidemail API responded with unexpected contentType.",
		httpStatus: 502,
	});
});

test("Falls back to API error message when developerMessage is missing", async () => {
	global.fetch.mockResolvedValue({
		headers: { get: () => "application/json" },
		status: 400,
		ok: false,
		json: () => Promise.resolve({ message: "Bad request" }),
	});
	const sidemail = configureSidemail({ apiKey: "123" });

	await expect(sidemail.performApiRequest("path", {})).rejects.toMatchObject({
		name: "SidemailError",
		message: "Bad request",
		httpStatus: 400,
	});
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
		expect.objectContaining(payload),
		undefined
	);
});

test("Sends batch email payloads", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.performApiRequest = jest.fn(() => Promise.resolve([{ is: "ok" }]));

	const payload = [
		{ toAddress: "one@example.com" },
		{ toAddress: "two@example.com" },
	];
	const response = await sidemail.sendEmail(payload);

	expect(response[0].is).toBe("ok");
	expect(sidemail.performApiRequest).toHaveBeenCalledWith(
		"email/send",
		payload,
		undefined
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
		expect.objectContaining(payload),
		undefined
	);
});

test("Query contacts", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.contacts.performApiRequest = jest.fn(() =>
		Promise.resolve({ data: [], pageCount: 0, totalCount: 0 })
	);

	const payload = { search: "@lightning.com", limit: 20 };
	const response = await sidemail.contacts.query(payload);
	expect(response.totalCount).toBe(0);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.contacts.performApiRequest).toHaveBeenCalledWith(
		"contacts/query",
		expect.objectContaining(payload),
		expect.objectContaining({ method: "POST" })
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
		`contacts`,
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

test("Validate an email address", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.email.performApiRequest = jest.fn(() =>
		Promise.resolve({ results: [{ email: "test@example.com", valid: true }] })
	);

	const payload = { email: "test@example.com", isDeep: true };
	const response = await sidemail.email.validate(payload);
	expect(response.results[0].valid).toBe(true);
	expect(sidemail.email.performApiRequest).toHaveBeenCalledTimes(1);
	expect(sidemail.email.performApiRequest).toHaveBeenCalledWith(
		"email/validate",
		expect.objectContaining(payload),
		expect.objectContaining({ method: "POST" })
	);
});

test("Template methods", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.templates.performApiRequest = jest.fn(() =>
		Promise.resolve({
			data: [],
			hasMore: false,
			paginationCursorNext: null,
		})
	);

	await sidemail.templates.list({ limit: 10, includeContent: true });
	await sidemail.templates.get("template-id");
	await sidemail.templates.create({ name: "Welcome" });
	await sidemail.templates.update("template-id", { subject: "Hello" });
	await sidemail.templates.gallery();
	await sidemail.templates.fonts();

	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		1,
		"templates?limit=10&includeContent=true",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		2,
		"templates/template-id",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		3,
		"templates",
		expect.objectContaining({ name: "Welcome" }),
		expect.objectContaining({ method: "POST" })
	);
	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		4,
		"templates/template-id",
		expect.objectContaining({ subject: "Hello" }),
		expect.objectContaining({ method: "PATCH" })
	);
	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		5,
		"templates/gallery",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.templates.performApiRequest).toHaveBeenNthCalledWith(
		6,
		"templates/fonts",
		null,
		expect.objectContaining({ method: "GET" })
	);
});

test("Domain methods", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.domains.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);

	await sidemail.domains.list();
	await sidemail.domains.create({ domain: "example.com" });
	await sidemail.domains.delete("domain-id");

	expect(sidemail.domains.performApiRequest).toHaveBeenNthCalledWith(
		1,
		"domains",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.domains.performApiRequest).toHaveBeenNthCalledWith(
		2,
		"domains",
		expect.objectContaining({ domain: "example.com" }),
		expect.objectContaining({ method: "POST" })
	);
	expect(sidemail.domains.performApiRequest).toHaveBeenNthCalledWith(
		3,
		"domains/domain-id",
		null,
		expect.objectContaining({ method: "DELETE" })
	);
});

test("Inbound methods", async () => {
	const sidemail = configureSidemail({ apiKey: "123" });
	sidemail.inbound.routes.performApiRequest = jest.fn(() =>
		Promise.resolve({ is: "ok" })
	);
	sidemail.inbound.emails.performApiRequest = jest.fn(() =>
		Promise.resolve({
			data: [],
			hasMore: false,
			paginationCursorNext: null,
		})
	);

	await sidemail.inbound.routes.list();
	await sidemail.inbound.routes.create({ domain: "example.com" });
	await sidemail.inbound.routes.update("route-id", { isEnabled: false });
	await sidemail.inbound.routes.delete("route-id");
	await sidemail.inbound.emails.list({ limit: 20 });
	await sidemail.inbound.emails.get("email-id");

	expect(sidemail.inbound.routes.performApiRequest).toHaveBeenNthCalledWith(
		1,
		"inbound/routes",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.inbound.routes.performApiRequest).toHaveBeenNthCalledWith(
		2,
		"inbound/routes",
		expect.objectContaining({ domain: "example.com" }),
		expect.objectContaining({ method: "POST" })
	);
	expect(sidemail.inbound.routes.performApiRequest).toHaveBeenNthCalledWith(
		3,
		"inbound/routes/route-id",
		expect.objectContaining({ isEnabled: false }),
		expect.objectContaining({ method: "PATCH" })
	);
	expect(sidemail.inbound.routes.performApiRequest).toHaveBeenNthCalledWith(
		4,
		"inbound/routes/route-id",
		null,
		expect.objectContaining({ method: "DELETE" })
	);
	expect(sidemail.inbound.emails.performApiRequest).toHaveBeenNthCalledWith(
		1,
		"inbound/emails?limit=20",
		null,
		expect.objectContaining({ method: "GET" })
	);
	expect(sidemail.inbound.emails.performApiRequest).toHaveBeenNthCalledWith(
		2,
		"inbound/emails/email-id",
		null,
		expect.objectContaining({ method: "GET" })
	);
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
