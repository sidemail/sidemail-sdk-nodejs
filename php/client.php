<?php

declare(strict_types=1);

namespace Sidemail;

use Closure;
use RuntimeException;
use InvalidArgumentException;

/**
 * Simple HTTP client abstraction.
 */
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

/**
 * Default cURL-based HTTP client.
 */
final class CurlHttpClient implements HttpClient
{
    private string $defaultUserAgent;

    public function __construct(?string $defaultUserAgent = null)
    {
        $this->defaultUserAgent = $defaultUserAgent ?? 'sidemail-sdk-php/0.1.0';
    }

    public function request(
        string $method,
        string $url,
        array $headers = [],
        array $query = [],
        ?string $body = null,
        float $timeout = 10.0
    ): HttpResponse {
        if (!empty($query)) {
            $qs = http_build_query($query);
            $url .= (str_contains($url, '?') ? '&' : '?') . $qs;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            throw new NetworkException('Unable to initialize cURL.');
        }

        $headerLines = [];
        $hasUserAgent = false;
        foreach ($headers as $name => $value) {
            if (strtolower($name) === 'user-agent') {
                $hasUserAgent = true;
            }
            $headerLines[] = $name . ': ' . $value;
        }

        if (!$hasUserAgent) {
            $headerLines[] = 'User-Agent: ' . $this->defaultUserAgent;
        }

        $responseHeaders = [];

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $header) use (&$responseHeaders): int {
                $len = strlen($header);
                $parts = explode(':', $header, 2);
                if (count($parts) === 2) {
                    $name = strtolower(trim($parts[0]));
                    $value = trim($parts[1]);
                    $responseHeaders[$name][] = $value;
                }
                return $len;
            },
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $responseBody = curl_exec($ch);
        if ($responseBody === false) {
            $err = curl_error($ch);
            $code = curl_errno($ch);
            curl_close($ch);
            throw new NetworkException("cURL error ({$code}): {$err}");
        }

        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0;
        curl_close($ch);

        return new HttpResponse($status, (string) $responseBody, $responseHeaders);
    }
}

/**
 * Simple HTTP response value object.
 */
final class HttpResponse
{
    public function __construct(
        public int $statusCode,
        public string $body,
        public array $headers = []
    ) {
    }
}

/**
 * Base exception.
 */
class SidemailException extends RuntimeException
{
}

/**
 * Network-level errors (connection, timeouts, etc.).
 */
class NetworkException extends SidemailException
{
}

/**
 * Auth-related errors (401/403).
 */
class SidemailAuthException extends SidemailException
{
}

/**
 * API-level errors with status code & payload.
 */
class SidemailApiException extends SidemailException
{
    private int $status;
    private array $payload;

    public function __construct(int $status, array $payload = [])
    {
        $this->status = $status;
        $this->payload = $payload;
        $message = sprintf(
            'HTTP %d: %s',
            $status,
            $payload['developerMessage'] ?? 'API error'
        );
        parent::__construct($message);
    }

    public function getStatus(): int
    {
        return $this->status;
    }

    public function getPayload(): array
    {
        return $this->payload;
    }
}

/**
 * SDK configuration.
 */
final class Config
{
    public function __construct(
        public string $apiKey,
        public string $baseUrl,
        public float $timeout,
        public string $userAgent
    ) {
    }
}

/**
 * Resource with dot-access and preserved raw data.
 */
final class Resource implements \ArrayAccess, \IteratorAggregate, \Countable
{
    /** @var array<string, mixed> */
    private array $data = [];

    /** @var array<string, mixed> */
    private array $raw;

    /**
     * @param array<string, mixed> $data
     */
    public function __construct(array $data)
    {
        $this->raw = $data;

        foreach ($data as $k => $v) {
            $key = self::safeAttr((string) $k);
            $this->data[$key] = wrap_any($v);
        }
    }

    public function __get(string $name): mixed
    {
        if (!array_key_exists($name, $this->data)) {
            throw new InvalidArgumentException("Unknown property: {$name}");
        }
        return $this->data[$name];
    }

    public function __isset(string $name): bool
    {
        return isset($this->data[$name]);
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->data[$key] ?? $default;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $unwind = function (mixed $v) use (&$unwind): mixed {
            if ($v instanceof self) {
                $out = [];
                foreach ($v->data as $k => $val) {
                    $out[$k] = $unwind($val);
                }
                return $out;
            }
            if (is_array($v)) {
                $out = [];
                foreach ($v as $item) {
                    $out[] = $unwind($item);
                }
                return $out;
            }
            return $v;
        };

        $result = [];
        foreach ($this->data as $k => $v) {
            $result[$k] = $unwind($v);
        }
        return $result;
    }

    /**
     * Original raw array (camelCase keys etc.).
     *
     * @return array<string, mixed>
     */
    public function raw(): array
    {
        return $this->raw;
    }

    // ArrayAccess

    public function offsetExists(mixed $offset): bool
    {
        return isset($this->data[$offset]);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->data[$offset];
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        throw new RuntimeException('Resource is read-only.');
    }

    public function offsetUnset(mixed $offset): void
    {
        throw new RuntimeException('Resource is read-only.');
    }

    // IteratorAggregate

    public function getIterator(): \Traversable
    {
        return new \ArrayIterator($this->data);
    }

    // Countable

    public function count(): int
    {
        return count($this->data);
    }

    private static function safeAttr(string $name): string
    {
        if (!self::isValidIdentifier($name) || self::isPhpKeyword($name)) {
            return $name . '_';
        }
        return $name;
    }

    private static function isValidIdentifier(string $name): bool
    {
        return (bool) preg_match('/^[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*$/', $name);
    }

    private static function isPhpKeyword(string $name): bool
    {
        static $keywords = [
            'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch',
            'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'else',
            'elseif', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch',
            'endwhile', 'extends', 'final', 'finally', 'for', 'foreach', 'function',
            'global', 'goto', 'if', 'implements', 'include', 'include_once', 'instanceof',
            'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or',
            'print', 'private', 'protected', 'public', 'readonly', 'require',
            'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset',
            'use', 'var', 'while', 'xor', 'yield', 'int', 'float', 'bool', 'string',
            'true', 'false', 'null', 'void', 'iterable', 'object', 'mixed', 'never',
        ];
        return in_array(strtolower($name), $keywords, true);
    }

    public function __debugInfo(): array
    {
        // show only the wrapped structure when using var_dump()
        return $this->toArray();
    }
}

/**
 * Query result with automatic paging.
 */
final class QueryResult implements \IteratorAggregate
{
    /** @var array<int, mixed> */
    public array $data;

    public ?int $total;
    public ?int $limit;
    public ?int $offset;
    public ?string $nextCursor;
    public ?string $prevCursor;
    public bool $hasMore;
    public bool $hasPrev;

    private mixed $page;
    private string $dataKey;
    /** @var Closure(): array{0:mixed,1:bool}|null */
    private ?Closure $fetchNext;
    /** @var Closure(): array{0:mixed,1:bool}|null */
    private ?Closure $fetchPrev;

    /**
     * @param mixed $firstPage
     * @param Closure(): array{0:mixed,1:bool}|null $fetchNext
     * @param Closure(): array{0:mixed,1:bool}|null $fetchPrev
     */
    public function __construct(
        mixed $firstPage,
        string $dataKey,
        ?Closure $fetchNext,
        ?Closure $fetchPrev,
        bool $hasMore = false,
        bool $hasPrev = false,
        ?string $nextCursor = null,
        ?string $prevCursor = null,
        ?int $offset = null,
        ?int $limit = null
    ) {
        $this->page = $firstPage ?? [];
        $this->dataKey = $dataKey;
        $this->fetchNext = $fetchNext;
        $this->fetchPrev = $fetchPrev;

        $items = page_get($this->page, $dataKey) ?? [];
        $this->data = array_values($items);

        $this->total = is_array($this->page) || $this->page instanceof Resource
            ? (page_get($this->page, 'total') ?? null)
            : null;

        $this->limit = $limit;
        $this->offset = $offset;
        $this->nextCursor = $nextCursor;
        $this->prevCursor = $prevCursor;
        $this->hasMore = $hasMore;
        $this->hasPrev = $hasPrev;
    }

    public function getIterator(): \Traversable
    {
        return new \ArrayIterator($this->data);
    }

    /**
     * @return \Generator<mixed>
     */
    public function autoPaging(): \Generator
    {
        foreach ($this->data as $item) {
            yield $item;
        }

        while ($this->hasMore && $this->fetchNext) {
            [$nextPage, $more] = ($this->fetchNext)();
            $this->hasMore = $more;

            if (!is_array($nextPage) && !($nextPage instanceof Resource)) {
                return;
            }

            $items = page_get($nextPage, $this->dataKey) ?? [];
            if (empty($items)) {
                return;
            }

            foreach ($items as $item) {
                yield $item;
            }
        }
    }

    /**
     * @return \Generator<mixed>
     */
    public function autoPagingPrev(): \Generator
    {
        while ($this->hasPrev && $this->fetchPrev) {
            [$prevPage, $hasPrev] = ($this->fetchPrev)();
            $this->hasPrev = $hasPrev;

            if (!is_array($prevPage) && !($prevPage instanceof Resource)) {
                return;
            }

            $items = page_get($prevPage, $this->dataKey) ?? [];
            if (empty($items)) {
                return;
            }

            foreach ($items as $item) {
                yield $item;
            }
        }
    }

    public function firstPage(): mixed
    {
        return $this->page;
    }

    public function __toString(): string
    {
        return sprintf(
            '<QueryResult items=%d has_more=%s has_prev=%s offset=%s next_cursor=%s prev_cursor=%s limit=%s>',
            count($this->data),
            $this->hasMore ? 'true' : 'false',
            $this->hasPrev ? 'true' : 'false',
            $this->offset ?? 'null',
            $this->nextCursor ?? 'null',
            $this->prevCursor ?? 'null',
            $this->limit ?? 'null'
        );
    }
}

/**
 * Offset-based pagination helper.
 *
 * @param callable(int, ?int):mixed $fetchPage
 */
function offset_query(
    callable $fetchPage,
    int $startOffset = 0,
    ?int $pageSize = null,
    string $dataKey = 'data',
    string $hasMoreKey = 'hasMore'
): QueryResult {
    $offset = max(0, $startOffset);

    $first = $fetchPage($offset, $pageSize) ?? [];
    $items = page_get($first, $dataKey) ?? [];
    $received = count($items);

    var_dump($first);

    $hasMoreFirst = (bool) (page_get($first, $hasMoreKey) ?? false);

    $fetchNext = function () use (
        &$offset,
        &$received,
        $fetchPage,
        $pageSize,
        $dataKey,
        $hasMoreKey
    ): array {
        // if previous page had no items, stop
        if ($received === 0) {
            return [null, false];
        }

        $offset += $received;

        $page = $fetchPage($offset, $pageSize) ?? [];
        $items = page_get($page, $dataKey) ?? [];
        $received = count($items);
        $hasMore = (bool) (page_get($page, $hasMoreKey) ?? false);

        return [$page, $hasMore];
    };

    return new QueryResult(
        firstPage: $first,
        dataKey: $dataKey,
        fetchNext: $fetchNext,
        fetchPrev: null,
        hasMore: $hasMoreFirst,
        offset: $startOffset,
        limit: $pageSize
    );
}


/**
 * Cursor-based pagination helper.
 *
 * @param callable(?string, ?string, ?int):mixed $fetchPage
 */
function cursor_query(
    callable $fetchPage,
    ?string $startCursorNext = null,
    ?string $startCursorPrev = null,
    ?int $pageSize = null,
    string $dataKey = 'data',
    string $nextCursorKey = 'paginationCursorNext',
    string $prevCursorKey = 'paginationCursorPrev',
    ?string $hasMoreKey = 'hasMore',
    ?string $hasPrevKey = 'hasPrev'
): QueryResult {
    $nextCur = $startCursorNext;
    $prevCur = $startCursorPrev;

    $first = $fetchPage($nextCur, $prevCur, $pageSize) ?? [];

    $nextCur = page_get($first, $nextCursorKey);
    $prevCur = page_get($first, $prevCursorKey);

    $hasMoreFirst = $hasMoreKey !== null
        ? (bool) (page_get($first, $hasMoreKey) ?? false)
        : ($nextCur !== null);

    $hasPrevFirst = $hasPrevKey !== null
        ? (bool) (page_get($first, $hasPrevKey) ?? false)
        : ($prevCur !== null);

    $fetchNext = function () use (&$nextCur, $fetchPage, $pageSize, $nextCursorKey, $hasMoreKey): array {
        if (!$nextCur) {
            return [null, false];
        }

        $page = $fetchPage($nextCur, null, $pageSize) ?? [];
        $nextCur = page_get($page, $nextCursorKey);
        $more = $hasMoreKey !== null
            ? (bool) (page_get($page, $hasMoreKey) ?? false)
            : ($nextCur !== null);

        return [$page, $more];
    };

    $fetchPrev = function () use (&$prevCur, $fetchPage, $pageSize, $prevCursorKey, $hasPrevKey): array {
        if (!$prevCur) {
            return [null, false];
        }

        $page = $fetchPage(null, $prevCur, $pageSize) ?? [];
        $prevCur = page_get($page, $prevCursorKey);
        $prev = $hasPrevKey !== null
            ? (bool) (page_get($page, $hasPrevKey) ?? false)
            : ($prevCur !== null);

        return [$page, $prev];
    };

    return new QueryResult(
        $first,
        $dataKey,
        $fetchNext,
        $fetchPrev,
        $hasMoreFirst,
        $hasPrevFirst,
        page_get($first, $nextCursorKey),
        page_get($first, $prevCursorKey),
        null,
        $pageSize
    );
}

/**
 * Get key from array or Resource.
 */
function page_get(mixed $page, string $key): mixed
{
    if ($page instanceof Resource) {
        return $page->get($key);
    }

    if (is_array($page)) {
        return $page[$key] ?? null;
    }

    return null;
}

/**
 * Wrap any value into Resource / nested structures.
 */
function wrap_any(mixed $value): mixed
{
    if (is_array($value)) {
        if (array_is_list($value)) {
            $out = [];
            foreach ($value as $v) {
                $out[] = wrap_any($v);
            }
            return $out;
        }
        return new Resource($value);
    }

    return $value;
}

/**
 * Internal helper: build headers for a request.
 *
 * @return array<string, string>
 */
function build_headers(Config $cfg): array
{
    return [
        'Authorization' => 'Bearer ' . $cfg->apiKey,
        'Content-Type'  => 'application/json',
        'User-Agent'    => $cfg->userAgent,
    ];
}

/**
 * Internal helper: handle HTTP response.
 */
function handle_response(HttpResponse $resp): mixed
{
    if ($resp->statusCode >= 200 && $resp->statusCode < 300) {
        if ($resp->body !== '') {
            $data = json_decode($resp->body, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                return $resp->body;
            }
            return wrap_any($data);
        }
        return null;
    }

    $payload = json_decode($resp->body, true);
    if (!is_array($payload)) {
        $payload = [
            'developerMessage' => $resp->body !== '' ? $resp->body : 'Unknown error',
        ];
    }

    if (in_array($resp->statusCode, [401, 403], true)) {
        throw new SidemailAuthException($payload['developerMessage'] ?? 'Unauthorized');
    }

    throw new SidemailApiException($resp->statusCode, $payload);
}

/**
 * Email API.
 */
final class EmailApi
{
    private Config $cfg;
    private HttpClient $http;

    public function __construct(Config $cfg, HttpClient $http)
    {
        $this->cfg = $cfg;
        $this->http = $http;
    }

    /**
     * @param array<string, mixed> $params
     * @return mixed
     */
    public function send(array $params): mixed
    {
        $resp = $this->http->request(
            'POST',
            $this->cfg->baseUrl . '/email/send',
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    /**
     * @param array<string, mixed> $params
     */
    public function search(array $params = []): QueryResult
    {
        $endpointUrl = $this->cfg->baseUrl . '/email/search';

        $nextCursorStart = $params['paginationCursorNext'] ?? null;
        unset($params['paginationCursorNext']);

        $prevCursorStart = $params['paginationCursorPrev'] ?? null;
        unset($params['paginationCursorPrev']);

        $pageSize = isset($params['limit']) ? (int) $params['limit'] : null;
        $basePayload = $params;

        $fetch = function (?string $nextCursor, ?string $prevCursor, ?int $limit) use (
            $endpointUrl,
            $basePayload
        ): mixed {
            $payload = $basePayload;
            if ($limit !== null) {
                $payload['limit'] = $limit;
            }
            if ($nextCursor) {
                $payload['paginationCursorNext'] = $nextCursor;
            }
            if ($prevCursor) {
                $payload['paginationCursorPrev'] = $prevCursor;
            }

            $resp = $this->http->request(
                'POST',
                $endpointUrl,
                build_headers($this->cfg),
                [],
                json_encode($payload, JSON_THROW_ON_ERROR),
                $this->cfg->timeout
            );

            return handle_response($resp);
        };

        return cursor_query(
            $fetch,
            $nextCursorStart,
            $prevCursorStart,
            $pageSize
        );
    }

    public function get(string $emailId): mixed
    {
        $resp = $this->http->request(
            'GET',
            $this->cfg->baseUrl . '/email/' . rawurlencode($emailId),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        $out = handle_response($resp);
        if ($out instanceof Resource) {
            $email = $out->get('email');
            return $email ?? $out;
        }
        if (is_array($out)) {
            return $out['email'] ?? $out;
        }
        return $out;
    }

    public function delete(string $emailId): mixed
    {
        $resp = $this->http->request(
            'DELETE',
            $this->cfg->baseUrl . '/email/' . rawurlencode($emailId),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }
}

/**
 * Contacts API.
 */
final class ContactsApi
{
    private Config $cfg;
    private HttpClient $http;

    public function __construct(Config $cfg, HttpClient $http)
    {
        $this->cfg = $cfg;
        $this->http = $http;
    }

    /**
     * @param array<string, mixed> $params
     */
    public function createOrUpdate(array $params): mixed
    {
        $resp = $this->http->request(
            'POST',
            $this->cfg->baseUrl . '/contacts',
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    public function find(string $emailAddress): mixed
    {
        $resp = $this->http->request(
            'GET',
            $this->cfg->baseUrl . '/contacts/' . rawurlencode($emailAddress),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        $out = handle_response($resp);
        if ($out instanceof Resource) {
            $contact = $out->get('contact');
            return $contact ?? $out;
        }
        if (is_array($out)) {
            return $out['contact'] ?? $out;
        }
        return $out;
    }

    /**
     * Offset-based query.
     *
     * @param array<string, mixed> $params
     */
    public function query(array $params = []): QueryResult
    {
        $startOffset = isset($params['offset']) ? (int) $params['offset'] : 0;
        unset($params['offset']);

        $pageSize = isset($params['limit']) ? (int) $params['limit'] : null;
        $basePayload = $params;

        $fetchPage = function (int $offset, ?int $limit) use ($basePayload): mixed {
            $payload = $basePayload;
            $payload['offset'] = $offset;
            if ($limit !== null) {
                $payload['limit'] = $limit;
            }

            $resp = $this->http->request(
                'POST',
                $this->cfg->baseUrl . '/contacts/query',
                build_headers($this->cfg),
                [],
                json_encode($payload, JSON_THROW_ON_ERROR),
                $this->cfg->timeout
            );

            return handle_response($resp);
        };

        return offset_query($fetchPage, $startOffset, $pageSize);
    }

    /**
     * Cursor-based list.
     *
     * @param array<string, mixed> $params
     */
    public function list(array $params = []): QueryResult
    {
        $nextStart = $params['paginationCursorNext'] ?? null;
        unset($params['paginationCursorNext']);

        $prevStart = $params['paginationCursorPrev'] ?? null;
        unset($params['paginationCursorPrev']);

        $pageSize = isset($params['limit']) ? (int) $params['limit'] : null;
        $basePayload = $params;

        $fetchPage = function (?string $nextCur, ?string $prevCur, ?int $limit) use ($basePayload): mixed {
            $query = $basePayload;
            if ($limit !== null) {
                $query['limit'] = $limit;
            }
            if ($nextCur) {
                $query['paginationCursorNext'] = $nextCur;
            }
            if ($prevCur) {
                $query['paginationCursorPrev'] = $prevCur;
            }

            $resp = $this->http->request(
                'GET',
                $this->cfg->baseUrl . '/contacts',
                build_headers($this->cfg),
                $query,
                null,
                $this->cfg->timeout
            );

            return handle_response($resp);
        };

        return cursor_query(
            $fetchPage,
            $nextStart,
            $prevStart,
            $pageSize
        );
    }

    public function delete(string $emailAddress): mixed
    {
        $resp = $this->http->request(
            'DELETE',
            $this->cfg->baseUrl . '/contacts/' . rawurlencode($emailAddress),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }
}

/**
 * Messenger API.
 */
final class MessengerApi
{
    private Config $cfg;
    private HttpClient $http;

    public function __construct(Config $cfg, HttpClient $http)
    {
        $this->cfg = $cfg;
        $this->http = $http;
    }

    /**
     * @param array<string, mixed> $params
     */
    public function list(array $params = []): QueryResult
    {
        $startOffset = isset($params['offset']) ? (int) $params['offset'] : 0;
        unset($params['offset']);

        $pageSize = isset($params['limit']) ? (int) $params['limit'] : null;
        $base = $params;

        $fetchPage = function (int $offset, ?int $limit) use ($base): mixed {
            $query = $base;
            $query['offset'] = $offset;
            if ($limit !== null) {
                $query['limit'] = $limit;
            }

            $resp = $this->http->request(
                'GET',
                $this->cfg->baseUrl . '/messenger',
                build_headers($this->cfg),
                $query,
                null,
                $this->cfg->timeout
            );

            return handle_response($resp);
        };

        return offset_query($fetchPage, $startOffset, $pageSize);
    }

    public function get(string $messengerId): mixed
    {
        $resp = $this->http->request(
            'GET',
            $this->cfg->baseUrl . '/messenger/' . rawurlencode($messengerId),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    /**
     * @param array<string, mixed> $params
     */
    public function create(array $params): mixed
    {
        $resp = $this->http->request(
            'POST',
            $this->cfg->baseUrl . '/messenger',
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    /**
     * @param array<string, mixed> $params
     */
    public function update(string $messengerId, array $params): mixed
    {
        $resp = $this->http->request(
            'PATCH',
            $this->cfg->baseUrl . '/messenger/' . rawurlencode($messengerId),
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    public function delete(string $messengerId): mixed
    {
        $resp = $this->http->request(
            'DELETE',
            $this->cfg->baseUrl . '/messenger/' . rawurlencode($messengerId),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }
}

/**
 * Domains API.
 */
final class DomainsApi
{
    private Config $cfg;
    private HttpClient $http;

    public function __construct(Config $cfg, HttpClient $http)
    {
        $this->cfg = $cfg;
        $this->http = $http;
    }

    public function list(): mixed
    {
        $resp = $this->http->request(
            'GET',
            $this->cfg->baseUrl . '/domains',
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    /**
     * @param array<string, mixed> $params
     */
    public function create(array $params): mixed
    {
        $resp = $this->http->request(
            'POST',
            $this->cfg->baseUrl . '/domains',
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    public function delete(string $domainId): mixed
    {
        $resp = $this->http->request(
            'DELETE',
            $this->cfg->baseUrl . '/domains/' . rawurlencode($domainId),
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }
}

/**
 * Project API.
 */
final class ProjectApi
{
    private Config $cfg;
    private HttpClient $http;

    public function __construct(Config $cfg, HttpClient $http)
    {
        $this->cfg = $cfg;
        $this->http = $http;
    }

    /**
     * @param array<string, mixed> $params
     */
    public function create(array $params): mixed
    {
        $resp = $this->http->request(
            'POST',
            $this->cfg->baseUrl . '/project',
            build_headers($this->cfg),
            [],
            json_encode($params, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    public function get(): mixed
    {
        $resp = $this->http->request(
            'GET',
            $this->cfg->baseUrl . '/project',
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function update(array $data): mixed
    {
        $resp = $this->http->request(
            'PATCH',
            $this->cfg->baseUrl . '/project',
            build_headers($this->cfg),
            [],
            json_encode($data, JSON_THROW_ON_ERROR),
            $this->cfg->timeout
        );

        return handle_response($resp);
    }

    public function delete(): mixed
    {
        $resp = $this->http->request(
            'DELETE',
            $this->cfg->baseUrl . '/project',
            build_headers($this->cfg),
            [],
            null,
            $this->cfg->timeout
        );

        return handle_response($resp);
    }
}

/**
 * Main Sidemail client.
 */
final class Sidemail
{
    public const API_ROOT = 'https://api.sidemail.io/v1';

    private Config $cfg;
    private HttpClient $http;

    public EmailApi $email;
    public ContactsApi $contacts;
    public MessengerApi $messenger;
    public DomainsApi $domains;
    public ProjectApi $project;

    public function __construct(
        ?string $apiKey = null,
        string $baseUrl = self::API_ROOT,
        float $timeout = 10.0,
        ?HttpClient $httpClient = null,
        string $userAgent = 'sidemail-sdk-php/0.1.0'
    ) {
        $key = $apiKey ?: getenv('SIDEMAIL_API_KEY');
        if (!$key) {
            throw new SidemailException('Missing API key. Pass apiKey or set SIDEMAIL_API_KEY.');
        }

        $this->cfg = new Config(
            apiKey: $key,
            baseUrl: rtrim($baseUrl, '/'),
            timeout: $timeout,
            userAgent: $userAgent
        );

        $this->http = $httpClient ?: new CurlHttpClient($userAgent);

        $this->email = new EmailApi($this->cfg, $this->http);
        $this->contacts = new ContactsApi($this->cfg, $this->http);
        $this->messenger = new MessengerApi($this->cfg, $this->http);
        $this->domains = new DomainsApi($this->cfg, $this->http);
        $this->project = new ProjectApi($this->cfg, $this->http);
    }

    /**
     * Convenience shortcut for sending email.
     *
     * @param array<string, mixed> $params
     */
    public function sendEmail(array $params): mixed
    {
        return $this->email->send($params);
    }

    /**
     * Prepare file attachment.
     *
     * @return array{name:string,content:string}
     */
    public static function fileToAttachment(string $name, string $data): array
    {
        return [
            'name' => $name,
            'content' => base64_encode($data),
        ];
    }
}
