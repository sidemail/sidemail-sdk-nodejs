const { version } = require("./package.json");

const { SidemailError } = require("./errors");

const DEFAULT_HOST = "https://api.sidemail.io";
const DEFAULT_BASE_PATH = "/v1/";

function createPathWithQuery(path, params = {}) {
	const query = new URLSearchParams();

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") {
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				query.append(key, String(item));
			}
		} else {
			query.set(key, String(value));
		}
	}

	const queryString = query.toString();
	return queryString ? `${path}?${queryString}` : path;
}

function createPaginatedResult(firstPage, fetchPage) {
	return {
		data: firstPage.data,
		hasMore: firstPage.hasMore,
		paginationCursorPrev: firstPage.paginationCursorPrev,
		paginationCursorNext: firstPage.paginationCursorNext,

		async autoPaginateEach(callback) {
			let page = firstPage;

			while (true) {
				if (page && Array.isArray(page.data)) {
					for (const item of page.data) {
						// eslint-disable-next-line no-await-in-loop
						await callback(item);
					}
				}

				if (!page || !page.hasMore || !page.paginationCursorNext) {
					break;
				}

				// eslint-disable-next-line no-await-in-loop
				page = await fetchPage(page.paginationCursorNext);
			}
		},

		async *[Symbol.asyncIterator]() {
			let page = firstPage;

			while (true) {
				if (page && Array.isArray(page.data)) {
					for (const item of page.data) {
						yield item;
					}
				}

				if (!page || !page.hasMore || !page.paginationCursorNext) {
					break;
				}

				page = await fetchPage(page.paginationCursorNext);
			}
		},
	};
}

class ContactMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async createOrUpdate(contactData, options) {
		if (!contactData) {
			throw new SidemailError(
				`Missing contact data. First argument must be object with valid contact data.`
			);
		}

		return this.performApiRequest("contacts", contactData, options);
	}

	async query(data = {}, options) {
		return this.performApiRequest("contacts/query", data, {
			...options,
			method: "POST",
		});
	}

	async find({ emailAddress } = {}, options) {
		if (!emailAddress) {
			throw new SidemailError(
				`Missing emailAddress. First argument must be object containing emailAddress of contact you wish to find.`
			);
		}

		return this.performApiRequest(`contacts/${emailAddress}`, null, {
			...options,
			method: "GET",
		});
	}

	async list({ paginationCursorNext } = {}, options) {
		const fetchPage = async (cursor) => {
			return this.performApiRequest(
				createPathWithQuery("contacts", { paginationCursorNext: cursor }),
				null,
				{
					...options,
					method: "GET",
				}
			);
		};

		const firstPage = await fetchPage(paginationCursorNext);

		return createPaginatedResult(firstPage, fetchPage);
	}

	async delete({ emailAddress } = {}, options) {
		if (!emailAddress) {
			throw new SidemailError(
				`Missing emailAddress. First argument must be object containing emailAddress of contact you wish to delete.`
			);
		}

		return this.performApiRequest(`contacts/${emailAddress}`, null, {
			...options,
			method: "DELETE",
		});
	}
}

class EmailMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async send(data, options) {
		return this.performApiRequest("email/send", data, {
			...options,
			method: "POST",
		});
	}

	async search(data = {}, options) {
		const fetchPage = async (cursor) => {
			const body = cursor ? { ...data, paginationCursorNext: cursor } : data;
			return this.performApiRequest("email/search", body, {
				...options,
				method: "POST",
			});
		};

		const firstPage = await fetchPage();

		return createPaginatedResult(firstPage, fetchPage);
	}

	async validate(data, options) {
		return this.performApiRequest("email/validate", data, {
			...options,
			method: "POST",
		});
	}

	async get(id, options) {
		return this.performApiRequest(`email/${id}`, null, {
			...options,
			method: "GET",
		});
	}

	async delete(id, options) {
		return this.performApiRequest(`email/${id}`, null, {
			...options,
			method: "DELETE",
		});
	}
}

class TemplateMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async list(params = {}, options) {
		const { paginationCursorNext, ...query } = params;
		const fetchPage = async (cursor) => {
			return this.performApiRequest(
				createPathWithQuery("templates", {
					...query,
					paginationCursorNext: cursor,
				}),
				null,
				{
					...options,
					method: "GET",
				}
			);
		};

		const firstPage = await fetchPage(paginationCursorNext);

		return createPaginatedResult(firstPage, fetchPage);
	}

	async get(id, options) {
		return this.performApiRequest(`templates/${id}`, null, {
			...options,
			method: "GET",
		});
	}

	async create(data, options) {
		return this.performApiRequest("templates", data, {
			...options,
			method: "POST",
		});
	}

	async update(id, data, options) {
		return this.performApiRequest(`templates/${id}`, data, {
			...options,
			method: "PATCH",
		});
	}

	async gallery(options) {
		return this.performApiRequest("templates/gallery", null, {
			...options,
			method: "GET",
		});
	}

	async fonts(options) {
		return this.performApiRequest("templates/fonts", null, {
			...options,
			method: "GET",
		});
	}
}

class DomainMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async list(options) {
		return this.performApiRequest("domains", null, {
			...options,
			method: "GET",
		});
	}

	async create(data, options) {
		return this.performApiRequest("domains", data, {
			...options,
			method: "POST",
		});
	}

	async delete(id, options) {
		return this.performApiRequest(`domains/${id}`, null, {
			...options,
			method: "DELETE",
		});
	}
}

class InboundRouteMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async list(options) {
		return this.performApiRequest("inbound/routes", null, {
			...options,
			method: "GET",
		});
	}

	async create(data, options) {
		return this.performApiRequest("inbound/routes", data, {
			...options,
			method: "POST",
		});
	}

	async update(id, data, options) {
		return this.performApiRequest(`inbound/routes/${id}`, data, {
			...options,
			method: "PATCH",
		});
	}

	async delete(id, options) {
		return this.performApiRequest(`inbound/routes/${id}`, null, {
			...options,
			method: "DELETE",
		});
	}
}

class InboundEmailMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async list(params = {}, options) {
		const { paginationCursorNext, ...query } = params;
		const fetchPage = async (cursor) => {
			return this.performApiRequest(
				createPathWithQuery("inbound/emails", {
					...query,
					paginationCursorNext: cursor,
				}),
				null,
				{
					...options,
					method: "GET",
				}
			);
		};

		const firstPage = await fetchPage(paginationCursorNext);

		return createPaginatedResult(firstPage, fetchPage);
	}

	async get(id, options) {
		return this.performApiRequest(`inbound/emails/${id}`, null, {
			...options,
			method: "GET",
		});
	}
}

class InboundMethods {
	constructor({ performApiRequest }) {
		this.routes = new InboundRouteMethods({ performApiRequest });
		this.emails = new InboundEmailMethods({ performApiRequest });
	}
}

class ProjectMethods {
	constructor({ performApiRequest }) {
		this.performApiRequest = performApiRequest;
	}

	async create(data, options) {
		return this.performApiRequest("project", data, {
			...options,
			method: "POST",
		});
	}

	async get(options) {
		return this.performApiRequest("project", null, {
			...options,
			method: "GET",
		});
	}

	async update(data, options) {
		return this.performApiRequest("project", data, {
			...options,
			method: "PATCH",
		});
	}

	async delete(options) {
		return this.performApiRequest("project", null, {
			...options,
			method: "DELETE",
		});
	}
}

class Sidemail {
	constructor({
		apiKey = process.env.SIDEMAIL_API_KEY,
		host = DEFAULT_HOST,
		fetch: fetchImpl = globalThis.fetch,
		fetchOptions = {},
	} = {}) {
		if (!apiKey) {
			throw new SidemailError(
				`apiKey missing. Provide it as an option or set SIDEMAIL_API_KEY environment variable.`
			);
		}

		if (!fetchImpl) {
			throw new SidemailError(
				`fetch missing. Use Node.js 18 or higher, or provide a fetch implementation.`
			);
		}

		this.apiKey = apiKey;
		this.host = host;
		this.fetch = fetchImpl;
		this.fetchOptions = fetchOptions;
		this.performApiRequest = this.performApiRequest.bind(this);
		this.version = version;

		this.contacts = new ContactMethods({
			performApiRequest: this.performApiRequest,
		});
		this.email = new EmailMethods({
			performApiRequest: this.performApiRequest,
		});
		this.templates = new TemplateMethods({
			performApiRequest: this.performApiRequest,
		});
		this.domains = new DomainMethods({
			performApiRequest: this.performApiRequest,
		});
		this.inbound = new InboundMethods({
			performApiRequest: this.performApiRequest,
		});
		this.project = new ProjectMethods({
			performApiRequest: this.performApiRequest,
		});
	}

	getApiUrl(path) {
		return this.host + DEFAULT_BASE_PATH + path;
	}

	async performApiRequest(path, data, { method = "POST", signal } = {}) {
		let response;
		const fetch = this.fetch;
		const fetchOptions = { ...this.fetchOptions };
		delete fetchOptions.body;
		delete fetchOptions.headers;
		delete fetchOptions.method;
		delete fetchOptions.signal;

		try {
			response = await fetch(this.getApiUrl(path), {
				...fetchOptions,
				...(signal !== undefined && { signal }),
				method: method,
				...(data && { body: JSON.stringify(data) }),
				headers: {
					Accept: "application/json",
					Authorization: "Bearer " + this.apiKey,
					"Content-Type": "application/json",
					"User-Agent": `sidemail-sdk-nodejs/${version}`,
				},
			});
		} catch (error) {
			throw new SidemailError("Sidemail API request failed.", {
				cause: error,
			});
		}

		const contentType = response.headers.get("content-type") || "";

		if (!contentType.includes("application/json")) {
			throw new SidemailError(
				`Sidemail API responded with unexpected contentType.`,
				{ httpStatus: response.status }
			);
		}

		let json;

		try {
			json = await response.json();
		} catch (error) {
			throw new SidemailError("Sidemail API response body could not be read.", {
				cause: error,
				httpStatus: response.status,
			});
		}

		if (!response.ok) {
			throw new SidemailError(
				json.developerMessage || json.message || "Sidemail API request failed.",
				{
					...json,
					httpStatus: response.status,
				}
			);
		}

		return json;
	}

	async sendEmail(data, options) {
		return this.performApiRequest("email/send", data, options);
	}

	// Deprecated, here only to ensure backwards compatibility
	async sendMail(...args) {
		return this.sendEmail(...args);
	}

	fileToAttachment(name, data) {
		return { name, content: data.toString("base64") };
	}
}

module.exports = function configureSidemail(config) {
	return new Sidemail(config);
};
