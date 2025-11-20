# Sidemail PHP library

Official PHP client for the Sidemail API.

---

## Installation

```bash
composer require sidemail/sidemail
```

```php
<?php

require __DIR__ . '/vendor/autoload.php';

use Sidemail\Sidemail;

$sm = new Sidemail(apiKey: 'your-api-key');
```

## Requires:

- PHP 8.1+
- `ext-curl`
- HTTPS (OpenSSL + CA bundle)

---

## Authentication

You can pass the API key explicitly:

```php
$sm = new Sidemail\Sidemail(apiKey: 'your-api-key');
```

or via environment variable:

```bash
export SIDEMAIL_API_KEY=your-api-key
```

```php
$sm = new Sidemail\Sidemail(); // uses SIDEMAIL_API_KEY
```

---

## Client configuration

```php
$sm = new Sidemail\Sidemail(
    apiKey:    'your-api-key',
    baseUrl:   Sidemail\Sidemail::API_ROOT, // override for testing
    timeout:   10.0,                        // per-request timeout (seconds)
    httpClient: null,                       // custom HttpClient
);
```

---

## Errors

All exceptions extend `Sidemail\SidemailException`.

Specific types:

- `Sidemail\SidemailAuthException` – HTTP 401 / 403
- `Sidemail\SidemailApiException` – other non-2xx responses (`getStatus()`, `getPayload()`)
- `Sidemail\NetworkException` – network / cURL issues

Example:

```php
use Sidemail\Sidemail;
use Sidemail\SidemailException;
use Sidemail\SidemailAuthException;
use Sidemail\SidemailApiException;

$sm = new Sidemail(apiKey: 'your-api-key');

try {
    $resp = $sm->sendEmail([
        'toAddress'   => 'user@example.com',
        'fromAddress' => 'you@example.com',
        'subject'     => 'Hello',
        'text'        => 'Hello from Sidemail PHP',
    ]);
} catch (SidemailAuthException $e) {
    // invalid key / permissions
} catch (SidemailApiException $e) {
    // API error with JSON body
    error_log($e->getStatus());
    error_log(json_encode($e->getPayload()));
} catch (SidemailException $e) {
    // network or other SDK error
}
```

---

## Response objects

Most methods return `Sidemail\Resource`.

```php
$email = $sm->email->get('email-id');

// object-style access
echo $email->id;
echo $email->status;

// array-style access
echo $email['id'];

// nested structures
$event = $email->events[0];
echo $event->type;
echo $event->time;

// original payload
$raw  = $email->raw();      // original JSON as array
$flat = $email->toArray();  // recursively unwrapped array
```

If a field is not a valid PHP identifier or clashes with a keyword, it is exposed with a trailing underscore (e.g. `class` → `$resource->class_`).

---

## Pagination

List/search methods return a `Sidemail\QueryResult`.

Common properties:

```php
$result = $sm->email->search([
    'query' => ['status' => 'delivered'],
    'limit' => 50,
]);

$result->data;        // items on the first page
$result->total;       // total count, if provided
$result->limit;       // page size
$result->offset;      // offset (for offset-based endpoints)
$result->hasMore;     // whether more pages are available
$result->nextCursor;  // cursor (for cursor-based endpoints)
$result->prevCursor;
```

Iterate over all pages:

```php
foreach ($result->autoPaginate() as $email) {
    echo $email['id'], ' ', $email['status'], PHP_EOL;
}
```

If you only need the first page, use `$result->data`.

---

## Email API

Entry point: `$sm->email`
Shortcut: `$sm->sendEmail(...)`

### Send email

```php
$response = $sm->sendEmail([
    'toAddress'   => 'user@example.com',
    'fromAddress' => 'you@example.com',
    'fromName'    => 'Your App',
    'subject'     => 'Welcome',
    'text'        => 'Welcome to our app.',
    // 'html'         => '<strong>Welcome</strong>',
    // 'templateName' => 'WelcomeTemplate',
    // 'attachments'  => [...],
]);
```

Equivalent low-level call:

```php
$response = $sm->email->send([
    'toAddress'   => 'user@example.com',
    'fromAddress' => 'you@example.com',
    'subject'     => 'Welcome',
    'text'        => 'Welcome to our app.',
]);
```

### Attachments

```php
$data = file_get_contents('invoice.pdf');

$attachment = Sidemail\Sidemail::fileToAttachment('invoice.pdf', $data);

$sm->sendEmail([
    'toAddress'    => 'user@example.com',
    'fromAddress'  => 'you@example.com',
    'subject'      => 'Invoice',
    'text'         => 'Invoice attached.',
    'attachments'  => [$attachment],
]);
```

### Get email

```php
$email = $sm->email->get('email-id');

echo $email->id;
echo $email->status;
echo $email->createdAt;
```

### Delete email

```php
$resp = $sm->email->delete('email-id');
```

### Search emails

```php
$result = $sm->email->search([
    'query' => [
        'status'    => 'delivered',
        'toAddress' => 'user@example.com',
    ],
    'limit' => 100,
]);

foreach ($result->autoPaginate() as $email) {
    echo $email['id'], ' ', $email['status'], PHP_EOL;
}
```

---

## Contacts API

Entry point: `$sm->contacts`

### Create or update contact

```php
$contact = $sm->contacts->createOrUpdate([
    'email'      => 'user@example.com',
    'firstName'  => 'Jane',
    'lastName'   => 'Doe',
    'attributes' => [
        'plan' => 'pro',
    ],
]);
```

### Find contact

```php
$contact = $sm->contacts->find('user@example.com');

if ($contact !== null) {
    echo $contact->email;
}
```

### Query contacts

```php
$result = $sm->contacts->query([
    'limit' => 100,
    'query' => [
        'attributes.plan' => 'pro',
    ],
]);

foreach ($result->autoPaginate() as $contact) {
    echo $contact['email'], PHP_EOL;
}
```

### List contacts

```php
$result = $sm->contacts->list([
    'limit' => 50,
]);

foreach ($result->autoPaginate() as $contact) {
    echo $contact['email'], PHP_EOL;
}
```

### Delete contact

```php
$resp = $sm->contacts->delete('user@example.com');
```

---

## Messenger API

Entry point: `$sm->messenger`

### List messengers

```php
$result = $sm->messenger->list([
    'limit'  => 20,
    'offset' => 0,
]);

foreach ($result->autoPaginate() as $messenger) {
    echo $messenger['id'], ' ', $messenger['name'] ?? '', PHP_EOL;
}
```

### Get messenger

```php
$messenger = $sm->messenger->get('messenger-id');

echo $messenger->id;
echo $messenger->name;
```

### Create messenger

```php
$new = $sm->messenger->create([
    'name'        => 'My Messenger',
    'description' => 'In-app messenger',
    // other fields as defined by the API
]);
```

### Update messenger

```php
$updated = $sm->messenger->update('messenger-id', [
    'name' => 'Updated name',
]);
```

### Delete messenger

```php
$resp = $sm->messenger->delete('messenger-id');
```

---

## Domains API

Entry point: `$sm->domains`

### List domains

```php
$domains = $sm->domains->list();

// usually $domains->domains is an array
foreach ($domains->domains as $domain) {
    echo $domain['id'], ' ', $domain['name'] ?? '', PHP_EOL;
}
```

### Create domain

```php
$domain = $sm->domains->create([
    'name' => 'example.com',
    // other fields as defined by the API
]);
```

### Delete domain

```php
$resp = $sm->domains->delete('domain-id');
```

---

## Project API

Entry point: `$sm->project`

### Create project

```php
$project = $sm->project->create([
    'name' => 'My Project',
    // other fields
]);
```

### Get project

```php
$project = $sm->project->get();

echo $project->id;
echo $project->name;
```

### Update project

```php
$updated = $sm->project->update([
    'name' => 'Updated project name',
]);
```

### Delete project

```php
$resp = $sm->project->delete();
```

---

## Custom HTTP client

You can provide your own HTTP client by implementing `Sidemail\HttpClient`:

```php
namespace Sidemail;

interface HttpClient
{
    public function request(
        string $method,
        string $url,
        array $headers = [],
        array $query = [],
        ?string $body = null,
        float $timeout = 10.0
    ): HttpResponse;
}
```

Example integration with Guzzle:

```php
use Sidemail\HttpClient;
use Sidemail\HttpResponse;
use Sidemail\Sidemail;

final class GuzzleHttpClient implements HttpClient
{
    public function __construct(private \GuzzleHttp\Client $client)
    {
    }

    public function request(
        string $method,
        string $url,
        array $headers = [],
        array $query = [],
        ?string $body = null,
        float $timeout = 10.0
    ): HttpResponse {
        $response = $this->client->request($method, $url, [
            'headers' => $headers,
            'query'   => $query,
            'body'    => $body,
            'timeout' => $timeout,
        ]);

        return new HttpResponse(
            $response->getStatusCode(),
            (string) $response->getBody(),
            $response->getHeaders()
        );
    }
}

$sm = new Sidemail(
    apiKey: 'your-api-key',
    httpClient: new GuzzleHttpClient(new \GuzzleHttp\Client())
);
```
