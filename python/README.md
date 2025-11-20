# Sidemail Python library

Official Python client for the Sidemail API.

---

## Installation

```bash
pip install sidemail
```

---

## Send your first email

```python
from sidemail import Sidemail, SidemailAuthError, SidemailAPIError

sm = Sidemail(api_key="your-api-key")  # or set SIDEMAIL_API_KEY (see below)

try:
	resp = sm.send_email(
		toAddress="user@example.com",
		fromAddress="you@example.com",
		subject="Hello",
		text="Hello from Sidemail Python",
	)
```

Shortcut `send_email(...)` calls the Email API under the hood (`sm.email.send(...)`).

---

## Requirements

- Python 3.8+
- `httpx` (installed automatically)
- HTTPS (system CA bundle)

---

## Authentication

Pass the API key explicitly:

```python
from sidemail import Sidemail

sm = Sidemail(api_key="your-api-key")
```

…or via environment variable `SIDEMAIL_API_KEY`.

PowerShell (Windows):

```powershell
$env:SIDEMAIL_API_KEY = "your-api-key"
```

macOS/Linux (bash/zsh):

```bash
export SIDEMAIL_API_KEY=your-api-key
```

Then:

```python
from sidemail import Sidemail

sm = Sidemail()  # uses SIDEMAIL_API_KEY
```

---

## Client configuration

```python
import httpx
from sidemail import Sidemail

sm = Sidemail(
	api_key="your-api-key",
	base_url="https://api.sidemail.io/v1",  # override for testing
	timeout=10.0,                             # per-request timeout (seconds)
	session=httpx.Client(),                   # custom httpx.Client (proxies, retries, etc.)
)
```

Notes:

- `session` lets you reuse a configured `httpx.Client` (proxies, transport settings, connection pooling).
- `timeout` applies per request.

---

## Errors

All SDK errors inherit from `SidemailError`.

Specific types:

- `SidemailAuthError` – HTTP 401/403 (invalid key or insufficient permissions)
- `SidemailAPIError` – Other non-2xx responses; has `.status` and `.payload`

Example:

```python
from sidemail import Sidemail, SidemailError, SidemailAuthError, SidemailAPIError

sm = Sidemail(api_key="your-api-key")

try:
	sm.send_email(
		toAddress="user@example.com",
		fromAddress="you@example.com",
		subject="Hello",
		text="Hello",
	)
except SidemailAuthError:
	# invalid key / permissions
	...
except SidemailAPIError as e:
	# API error with JSON body
	print(e.status)
	print(e.payload)
except SidemailError:
	# network or other SDK error
	...
```

---

## Response objects

Most methods return a dict-like object with attribute access (called `Resource`).

```python
email = sm.email.get("email-id")

# attribute access
print(email.id)
print(email.status)

# dict-style access
print(email["id"])

# nested structures work the same way

# original JSON payload
raw = email.raw           # Mapping[str, Any]

# fully unwrapped Python dict
flat = email.to_dict()    # dict
```

If a field name isn’t a valid Python identifier (e.g., contains a dash) or collides with a keyword, it’s exposed with a trailing underscore (e.g., `class` → `resource.class_`).

---

## Pagination

List/search methods return a `QueryResult` with the first page in `result.data`.

Common properties:

```python
result = sm.email.search(
	query={"status": "delivered"},
	limit=50,
)

result.data        # items on the first page
result.total       # total count, if provided by the API
result.limit       # page size (if provided)
result.offset      # offset (for offset-based endpoints)
result.has_more    # whether more pages are available
result.next_cursor # cursor (for cursor-based endpoints)
result.prev_cursor
```

Iterate over all pages automatically:

```python
for email in result.auto_paging():
	print(email["id"], email.get("status"))
```

If you only need the first page, use `result.data`.

---

## Email API

Entry point: `sm.email`

Shortcut: `sm.send_email(...)`

### Send email

```python
resp = sm.send_email(
	toAddress="user@example.com",
	fromAddress="you@example.com",
	fromName="Your App",
	subject="Welcome",
	text="Welcome to our app.",
	# html="<strong>Welcome</strong>",
	# templateName="WelcomeTemplate",
	# attachments=[...],
)
```

Equivalent low-level call:

```python
resp = sm.email.send(
	toAddress="user@example.com",
	fromAddress="you@example.com",
	subject="Welcome",
	text="Welcome to our app.",
)
```

### Attachments

```python
from sidemail import Sidemail

with open("invoice.pdf", "rb") as f:
	attachment = Sidemail.file_to_attachment("invoice.pdf", f.read())

sm.send_email(
	toAddress="user@example.com",
	fromAddress="you@example.com",
	subject="Invoice",
	text="Invoice attached.",
	attachments=[attachment],
)
```

### Get email

```python
email = sm.email.get("email-id")
print(email.id, email.status, email.createdAt)
```

### Delete email

```python
resp = sm.email.delete("id")
```

### Search emails

```python
result = sm.email.search(
	query={
		"status": "delivered",
		"toAddress": "user@example.com",
	},
	limit=100,
)

for email in result.auto_paging():
	print(email["id"], email.get("status"))
```

---

## Contacts API

Entry point: `sm.contacts`

### Create or update contact

```python
contact = sm.contacts.create_or_update(
	email="user@example.com",
	firstName="Jane",
	lastName="Doe",
	attributes={
		"plan": "pro",
	},
)
```

### Find contact

```python
contact = sm.contacts.find("user@example.com")
if contact is not None:
	print(contact.email)
```

### Query contacts (offset-based)

```python
result = sm.contacts.query(
	limit=100,
	query={
		"attributes.plan": "pro",
	},
)

for contact in result.auto_paging():
	print(contact["email"])
```

### List contacts

```python
result = sm.contacts.list(limit=50)

for contact in result.auto_paging():
	print(contact["email"])
```

### Delete contact

```python
resp = sm.contacts.delete("user@example.com")
```

---

## Messenger API

Entry point: `sm.messenger`

### List messengers (offset-based)

```python
result = sm.messenger.list(limit=20, offset=0)

for messenger in result.auto_paging():
	print(messenger.get("id"), messenger.get("name"))
```

### Get messenger

```python
messenger = sm.messenger.get("messenger-id")
print(messenger.id, messenger.get("name"))
```

### Create messenger

```python
new = sm.messenger.create(
	subject="My Messenger",
	markdown="This is a broadcast-type email to many subscribers...",
	# other fields as supported by the API
)
```

### Update messenger

```python
updated = sm.messenger.update(
	"messenger-id",
	name="Updated name",
)
```

### Delete messenger

```python
resp = sm.messenger.delete("messenger-id")
```

---

## Domains API

Entry point: `sm.domains`

### List domains

```python
domains = sm.domains.list()

# Many responses include an array under "domains"
items = domains.domains if hasattr(domains, "domains") else domains.get("domains", [])
for d in items:
	print(d.get("id"), d.get("name"))
```

### Create domain

```python
domain = sm.domains.create(name="example.com")
```

### Delete domain

```python
resp = sm.domains.delete("domain-id")
```

---

## Project API

Entry point: `sm.project`

### Create project

```python
project = sm.project.create(name="My Project")
```

### Get project

```python
project = sm.project.get()
print(project.id, project.name)
```

### Update project

```python
updated = sm.project.update(data={
	"name": "Updated project name",
})
```

### Delete project

```python
resp = sm.project.delete()
```

---

## Attachments helper

Use `Sidemail.file_to_attachment(name, data: bytes)` to prepare an attachment object:

```python
from sidemail import Sidemail

with open("report.csv", "rb") as f:
	att = Sidemail.file_to_attachment("report.csv", f.read())

sm.send_email(
	toAddress="user@example.com",
	fromAddress="you@example.com",
	subject="Report",
	text="See attached.",
	attachments=[att],
)
```

---

## Notes

- All methods return plain Python structures (dicts/lists) wrapped with attribute access for convenience.
- If you need the exact original JSON, use `.raw`; for a standard nested dict, use `.to_dict()`.
- For testing against a mock server, set `base_url` when creating the client.
