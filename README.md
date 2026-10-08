# Sidemail Node.js library

The Sidemail Node.js library provides convenient access to the Sidemail.io API from applications written in server-side JavaScript.

See the [CHANGELOG](CHANGELOG.md) for version history and updates.

## Requirements

Node 18 or higher.

## Installation

Install this package with:

```sh
npm install sidemail --save
# or
yarn add sidemail
```

## Usage

First, the package needs to be configured with your project's API key, which you can find in the Sidemail Dashboard after you signed up.

Initiate the SDK:

```javascript
// Create Sidemail instance and set your API key.
const configureSidemail = require("sidemail");
const sidemail = configureSidemail({ apiKey: "xxxxx" });
```

Then, you can call `sidemail.sendEmail` to send emails like so:

```javascript
try {
	const response = await sidemail.sendEmail({
		toAddress: "user@email.com",
		fromAddress: "you@example.com",
		fromName: "Your app",
		templateName: "Welcome",
		templateProps: { foo: "bar" },
	});

	// Response contains email ID
	console.log(`Email ID '${response.id}' successfully queued for sending!`);
} catch (err) {
	// Uh-oh, we have an error! Your error handling logic...
	console.error(err);
}
```

The response will look like this:

```json
{
	"id": "5e858953daf20f3aac50a3da",
	"status": "queued"
}
```

Learn more about Sidemail API:

- [See all available API options](https://sidemail.io/docs/send-transactional-emails#discover-all-available-api-parameters)
- [See all possible errors and error codes](https://sidemail.io/docs/send-transactional-emails#api-errors)

## Network behavior

The SDK uses the native Node.js `fetch` implementation. It does not configure custom HTTP agents or connection headers, so connection pooling stays with Node's default fetch behavior.

If your environment requires custom networking or instrumentation, pass a custom `fetch` implementation:

```javascript
const sidemail = configureSidemail({
	apiKey: "xxxxx",
	fetch: customFetch,
});
```

You can also pass transport options to `fetch`. SDK request values such as `method`, `body`, `headers`, and `signal` are still managed by the SDK.

```javascript
const sidemail = configureSidemail({
	apiKey: "xxxxx",
	fetchOptions: {
		dispatcher: customDispatcher,
	},
});
```

Pass a `signal` as the last argument to cancel or time out an individual request:

```javascript
await sidemail.email.send(
	{
		toAddress: "user@email.com",
		fromAddress: "you@example.com",
		subject: "Hello",
		text: "Hello",
	},
	{ signal: AbortSignal.timeout(5000) }
);
```

## Email sending examples

### Send password reset email template

```javascript
await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromAddress: "you@example.com",
	fromName: "Your app",
	templateName: "Password reset",
	templateProps: { resetUrl: "https://your.app/reset?token=123" },
});
```

### Send a batch of emails

```javascript
await sidemail.sendEmail([
	{
		toAddress: "user1@email.com",
		fromAddress: "you@example.com",
		subject: "Hello",
		text: "Hello user 1",
	},
	{
		toAddress: "user2@email.com",
		fromAddress: "you@example.com",
		subject: "Hello",
		text: "Hello user 2",
	},
]);
```

### Schedule email delivery

```javascript
await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromName: "Startup name",
	fromAddress: "your@startup.com",
	templateName: "Welcome",
	templateProps: { firstName: "Patrik" },
	// Deliver email in 60 minutes from now
	scheduledAt: new Date(Date.now() + 60 * 60000).toISOString(),
});
```

### Send email template with dynamic list

Useful for dynamic data where you have `n` items that you want to render in email. For example, items in a receipt, weekly statistic per project, new comments, etc.

```javascript
await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromName: "Startup name",
	fromAddress: "your@startup.com",
	templateName: "Template with dynamic list",
	templateProps: {
		list: [
			{ text: "Dynamic list" },
			{ text: "allows you to generate email template content" },
			{ text: "based on template props." },
		],
	},
});
```

### Send custom HTML email

```javascript
await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromName: "Startup name",
	fromAddress: "your@startup.com",
	subject: "Testing html only custom emails :)",
	html: "<html><body><h1>Hello world! 👋</h1><body></html>",
});
```

### Send custom plain text email

```javascript
await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromName: "Startup name",
	fromAddress: "your@startup.com",
	subject: "Testing plain-text only custom emails :)",
	text: "Hello world! 👋",
});
```

## Error handling

The SDK throws `SidemailError` for all errors. API errors include `message`, `httpStatus`, `errorCode`, and `moreInfo`.

```javascript
try {
	await sidemail.sendEmail({
		toAddress: "user@example.com",
		fromAddress: "you@example.com",
		subject: "Hello",
		text: "Hello",
	});
} catch (err) {
	if (err.name === "SidemailError") {
		console.error(err.message, err.errorCode, err.httpStatus);
	}
}
```

## Attachments helper

You can use the `fileToAttachment` helper to easily encode file data for attachments:

```javascript
const configureSidemail = require("sidemail");
const sidemail = configureSidemail({ apiKey: "your-api-key" });

const fs = require("fs");
const pdfBuffer = fs.readFileSync("./invoice.pdf");
const attachment = sidemail.fileToAttachment("invoice.pdf", pdfBuffer);

await sidemail.sendEmail({
	toAddress: "user@email.com",
	fromAddress: "you@example.com",
	subject: "Invoice",
	text: "Invoice attached.",
	attachments: [attachment],
});
```

## Auto-pagination

The SDK provides automatic pagination for list and search endpoints that return paginated results. This allows you to iterate through all results without manually handling pagination cursors.

### Async iterator style

```javascript
const result = await sidemail.contacts.list();

for await (const contact of result) {
	console.log(contact.emailAddress);
	// Process each contact across all pages automatically
}
```

### Callback style

```javascript
const result = await sidemail.contacts.list();

await result.autoPaginateEach(async (contact) => {
	console.log(contact.emailAddress);
	// Process each contact across all pages automatically
});
```

**Supported methods:**

- `sidemail.contacts.list()`
- `sidemail.email.search()`
- `sidemail.templates.list()`
- `sidemail.inbound.emails.list()`

## Email methods

### Search emails

Searches emails based on the provided query and returns found email data. This endpoint is paginated and returns a maximum of 20 results per page. The email data are returned sorted by creation date, with the most recent emails appearing first. This endpoint supports [auto-pagination](#auto-pagination).

```javascript
const result = await sidemail.email.search({
	query: {
		toAddress: "john.doe@example.com",
		status: "delivered",
		templateProps: { foo: "bar" },
	},
});

console.log("Found emails:", result.data);
console.log("Has more:", result.hasMore);
```

### Validate an email address

Checks an email address without sending an email.

```javascript
const response = await sidemail.email.validate({
	email: "user@example.com",
	isDeep: false,
});

console.log(response.results[0].valid);
```

### Retrieve a specific email

Retrieves the email data. You need only supply the email ID.

```javascript
const response = await sidemail.email.get("SIDEMAIL_EMAIL_ID");
console.log("Email data:", response.email);
```

### Delete a scheduled email

Permanently deletes an email. It cannot be undone. Only scheduled emails which are yet to be sent can be deleted.

```javascript
const response = await sidemail.email.delete("SIDEMAIL_EMAIL_ID");
console.log("Email deleted:", response.deleted);
```

## Contact methods

### Create or update a contact

```javascript
try {
	const response = await sidemail.contacts.createOrUpdate({
		emailAddress: "marry@lightning.com",
		identifier: "123",
		customProps: {
			name: "Marry Lightning",
			// ... more of your contact props ...
		},
	});

	console.log(`Contact was '${response.status}'.`);
} catch (err) {
	// Uh-oh, we have an error! Your error handling logic...
	console.error(err);
}
```

### Find a contact

```javascript
const response = await sidemail.contacts.find({
	emailAddress: "marry@lightning.com",
});
```

### List all contacts

Lists all contacts in your project. This endpoint supports [auto-pagination](#auto-pagination).

```javascript
const result = await sidemail.contacts.list();

console.log(result.data); // array of contacts
console.log(result.hasMore); // boolean if more data
console.log(result.paginationCursorNext); // cursor for next page
```

### Query contacts

Retrieves contacts with advanced filters and pagination.

```javascript
const response = await sidemail.contacts.query({
	search: "@example.com",
	isSubscribed: true,
	limit: 20,
});

console.log(response.data);
console.log(response.totalCount);
```

### Delete a contact

```javascript
const response = await sidemail.contacts.delete({
	emailAddress: "marry@lightning.com",
});
```

## Template methods

### List templates

```javascript
const result = await sidemail.templates.list({
	limit: 100,
	includeContent: false,
});
```

### Retrieve a template

```javascript
const response = await sidemail.templates.get("SIDEMAIL_TEMPLATE_ID");
```

### Create a template

```javascript
const response = await sidemail.templates.create({
	name: "Welcome",
	subject: "Welcome to {project_name}",
	content: [{ type: "text", text: "Hello!" }],
});
```

### Update a template

```javascript
await sidemail.templates.update("SIDEMAIL_TEMPLATE_ID", {
	subject: "Welcome, {first_name}",
});
```

### List gallery templates and fonts

```javascript
const gallery = await sidemail.templates.gallery();
const fonts = await sidemail.templates.fonts();
```

## Domain methods

### List sending domains

```javascript
const response = await sidemail.domains.list();
```

### Create a sending domain

```javascript
const response = await sidemail.domains.create({
	domain: "example.com",
});
```

### Delete a sending domain

```javascript
await sidemail.domains.delete("SIDEMAIL_DOMAIN_ID");
```

## Inbound methods

### Manage inbound routes

```javascript
const routes = await sidemail.inbound.routes.list();

const created = await sidemail.inbound.routes.create({
	domain: "example.com",
	localPart: "*",
	responseMode: "accept",
	isEnabled: true,
});

await sidemail.inbound.routes.update("SIDEMAIL_INBOUND_ROUTE_ID", {
	isEnabled: false,
});

await sidemail.inbound.routes.delete("SIDEMAIL_INBOUND_ROUTE_ID");
```

### List and retrieve inbound emails

```javascript
const result = await sidemail.inbound.emails.list({
	limit: 20,
});

const email = await sidemail.inbound.emails.get("SIDEMAIL_RECEIVED_EMAIL_ID");
```

## Project methods

### Create a linked project

A linked project is automatically associated with a regular project based on the `apiKey` provided into `configureSidemail`. To personalize the email template design, make a subsequent update API request. Linked projects will be visible within the parent project on the API page in your Sidemail dashboard.

```javascript
// create a linked project && save API key from `response.apiKey` to your datastore
const response = await sidemail.project.create({
	name: "Customer X linked project",
});

// user.db.save({ sidemailApiKey: response.apiKey }) ...
```

### Update a linked project

Updates a linked project based on the `apiKey` provided into `configureSidemail`.

```javascript
await sidemail.project.update({
	name: "New name",
	emailTemplateDesign: {
		logo: {
			sizeWidth: 50,
			href: "https://example.com",
			file:
				"PHN2ZyBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGwtcnVsZT0iZXZlbm9kZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLW1pdGVybGltaXQ9IjIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtMTIgNS43MmMtMi42MjQtNC41MTctMTAtMy4xOTgtMTAgMi40NjEgMCAzLjcyNSA0LjM0NSA3LjcyNyA5LjMwMyAxMi41NC4xOTQuMTg5LjQ0Ni4yODMuNjk3LjI4M3MuNTAzLS4wOTQuNjk3LS4yODNjNC45NzctNC44MzEgOS4zMDMtOC44MTQgOS4zMDMtMTIuNTQgMC01LjY3OC03LjM5Ni02Ljk0NC0xMC0yLjQ2MXoiIGZpbGwtcnVsZT0ibm9uemVybyIvPjwvc3ZnPg==",
		},
		font: { name: "Acme" },
		colors: { highlight: "#0000FF", isDarkModeEnabled: true },
		unsubscribeText: "Darse de baja",
		footerTextTransactional:
			"You're receiving these emails because you registered for Acme Inc.",
	},
});
```

### Get a project

Retrieves project data based on the `apiKey` provided into `configureSidemail`. This method works for both normal projects created via Sidemail dashboard and linked projects created via the API.

```javascript
const response = await sidemail.project.get();
```

### Delete a linked project

Permanently deletes a linked project based on the `apiKey` provided into `configureSidemail`. It cannot be undone.

```javascript
await sidemail.project.delete();
```

## More info

Visit [Sidemail docs](https://sidemail.io/docs/) for more information.
