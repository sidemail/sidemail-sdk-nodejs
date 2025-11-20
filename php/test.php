<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require __DIR__ . '/client.php';

/**
 * Simple fake HTTP client for deterministic tests.
 */
final class FakeHttpClient implements \Sidemail\HttpClient
{
    /**
     * @var \Sidemail\HttpResponse[]
     */
    private array $queue;

    /**
     * Captured requests for assertions.
     *
     * @var array<int, array<string, mixed>>
     */
    public array $requests = [];

    /**
     * @param \Sidemail\HttpResponse[] $queue
     */
    public function __construct(array $queue = [])
    {
        $this->queue = $queue;
    }

    public function pushResponse(Sidemail\HttpResponse $response): void
    {
        $this->queue[] = $response;
    }

    public function request(
        string $method,
        string $url,
        array $headers = [],
        array $query = [],
        ?string $body = null,
        float $timeout = 10.0
    ): \Sidemail\HttpResponse {
        $this->requests[] = [
            'method'  => $method,
            'url'     => $url,
            'headers' => $headers,
            'query'   => $query,
            'body'    => $body,
            'timeout' => $timeout,
        ];

        if (empty($this->queue)) {
            throw new RuntimeException('No fake response queued.');
        }

        return array_shift($this->queue);
    }
}

final class SidemailClientTest extends TestCase
{
    private function makeJsonResponse(int $status, array $data): Sidemail\HttpResponse
    {
        return new Sidemail\HttpResponse($status, json_encode($data, JSON_THROW_ON_ERROR), []);
    }

    private function makeTextResponse(int $status, string $body): Sidemail\HttpResponse
    {
        return new Sidemail\HttpResponse($status, $body, []);
    }

    public function testMissingApiKeyThrows(): void
    {
        $this->expectException(Sidemail\SidemailException::class);
        new Sidemail\Sidemail(null, baseUrl: 'https://example.test', timeout: 1.0, httpClient: new FakeHttpClient());
    }

    public function testEnvApiKeyIsUsedWhenNotPassed(): void
    {
        putenv('SIDEMAIL_API_KEY=env-key');

        $client = new Sidemail\Sidemail(
            apiKey: null,
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: new FakeHttpClient()
        );

        $this->assertInstanceOf(Sidemail\Sidemail::class, $client);
        // cleanup
        putenv('SIDEMAIL_API_KEY');
    }

    public function testFileToAttachment(): void
    {
        $data = "hello";
        $attachment = Sidemail\Sidemail::fileToAttachment('test.txt', $data);

        $this->assertSame('test.txt', $attachment['name']);
        $this->assertSame(base64_encode($data), $attachment['content']);
    }

    public function testHandleResponseSuccessJsonWrapped(): void
    {
        $resp = $this->makeJsonResponse(200, ['foo' => 'bar']);
        $wrapped = Sidemail\handle_response($resp);

        $this->assertInstanceOf(Sidemail\Resource::class, $wrapped);
        $this->assertSame('bar', $wrapped->get('foo'));
        $this->assertSame(['foo' => 'bar'], $wrapped->toArray());
        $this->assertSame(['foo' => 'bar'], $wrapped->raw());
    }

    public function testHandleResponseSuccessNonJsonReturnsText(): void
    {
        $resp = $this->makeTextResponse(200, 'plain text');
        $out = Sidemail\handle_response($resp);

        $this->assertSame('plain text', $out);
    }

    public function testHandleResponseAuthErrorThrowsSidemailAuthException(): void
    {
        $resp = $this->makeJsonResponse(401, ['developerMessage' => 'Unauthorized test']);
        $this->expectException(Sidemail\SidemailAuthException::class);
        Sidemail\handle_response($resp);
    }

    public function testHandleResponseApiErrorThrowsSidemailApiException(): void
    {
        $resp = $this->makeJsonResponse(400, ['developerMessage' => 'Bad request']);
        try {
            Sidemail\handle_response($resp);
            $this->fail('Expected SidemailApiException not thrown.');
        } catch (Sidemail\SidemailApiException $e) {
            $this->assertSame(400, $e->getStatus());
            $this->assertSame('Bad request', $e->getPayload()['developerMessage']);
        }
    }

    public function testWrapAnyAndResourceNested(): void
    {
        $input = [
            'id' => 123,
            'child' => [
                'status' => 'ok',
            ],
            'list' => [
                ['value' => 1],
                ['value' => 2],
            ],
        ];

        $wrapped = Sidemail\wrap_any($input);

        $this->assertInstanceOf(Sidemail\Resource::class, $wrapped);
        $this->assertSame(123, $wrapped->id);
        $this->assertInstanceOf(Sidemail\Resource::class, $wrapped->child);
        $this->assertSame('ok', $wrapped->child->status);
        $this->assertIsArray($wrapped->list);
        $this->assertInstanceOf(Sidemail\Resource::class, $wrapped->list[0]);
        $this->assertSame(1, $wrapped->list[0]->value);

        $this->assertSame($input, $wrapped->raw());
        $this->assertSame($input, $wrapped->toArray());
    }

    public function testOffsetQueryAndAutoPaginate(): void
    {
        $pages = [
            ['data' => [['id' => 1], ['id' => 2]]],
            ['data' => [['id' => 3]]],
        ];

        $callCount = 0;

        $fetchPage = function (int $offset, ?int $limit) use (&$pages, &$callCount) {
            $this->assertSame(2, $limit); // page size below
            $this->assertLessThanOrEqual(2, $offset);
            $page = $pages[$callCount] ?? ['data' => []];
            $callCount++;
            return $page;
        };

        $qr = Sidemail\offset_query($fetchPage, startOffset: 0, pageSize: 2, dataKey: 'data');

        $ids = [];
        foreach ($qr->autoPaginate() as $item) {
            $ids[] = $item['id'];
        }

        $this->assertSame([1, 2, 3], $ids);
    }

    public function testCursorQueryAndAutoPaginate(): void
    {
        $pages = [
            [
                'data' => [['id' => 'a'], ['id' => 'b']],
                'paginationCursorNext' => 'next-cursor',
                'hasMore' => true,
            ],
            [
                'data' => [['id' => 'c']],
                'paginationCursorNext' => null,
                'hasMore' => false,
            ],
        ];

        $callCount = 0;

        $fetchPage = function (?string $next, ?string $prev, ?int $limit) use (&$pages, &$callCount) {
            $this->assertSame(2, $limit);
            $page = $pages[$callCount] ?? ['data' => []];
            $callCount++;
            return $page;
        };

        $qr = Sidemail\cursor_query(
            $fetchPage,
            startCursorNext: null,
            startCursorPrev: null,
            pageSize: 2,
            dataKey: 'data',
        );

        $ids = [];
        foreach ($qr->autoPaginate() as $item) {
            $ids[] = $item['id'];
        }

        $this->assertSame(['a', 'b', 'c'], $ids);
        $this->assertFalse($qr->hasMore);
    }

    public function testEmailSendAndGetAndDelete(): void
    {
        $fake = new FakeHttpClient([
            // sendEmail response
            $this->makeJsonResponse(200, [
                'id' => 'email-1',
                'status' => 'scheduled',
            ]),
            // get email response
            $this->makeJsonResponse(200, [
                'email' => [
                    'id' => 'email-1',
                    'status' => 'scheduled',
                ],
            ]),
            // delete response
            $this->makeJsonResponse(200, ['deleted' => true]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $resp = $client->sendEmail([
            'toAddress' => 'to@example.com',
            'fromAddress' => 'from@example.com',
            'subject' => 'Hi',
            'text' => 'Hello',
        ]);

        $this->assertInstanceOf(Sidemail\Resource::class, $resp);
        $this->assertSame('email-1', $resp->id);

        $email = $client->email->get('email-1');
        $this->assertInstanceOf(Sidemail\Resource::class, $email);
        $this->assertSame('email-1', $email->id);

        $deleted = $client->email->delete('email-1');
        $this->assertInstanceOf(Sidemail\Resource::class, $deleted);
        $this->assertTrue($deleted->deleted);

        $this->assertCount(3, $fake->requests);
        $this->assertStringEndsWith('/email/send', $fake->requests[0]['url']);
        $this->assertStringEndsWith('/email/email-1', $fake->requests[1]['url']);
        $this->assertSame('DELETE', $fake->requests[2]['method']);
    }

    public function testEmailSearchUsesCursorQueryAndAutoPaginate(): void
    {
        $fake = new FakeHttpClient([
            $this->makeJsonResponse(200, [
                'data' => [
                    ['id' => 'e1'],
                    ['id' => 'e2'],
                ],
                'paginationCursorNext' => 'next-1',
                'hasMore' => true,
            ]),
            $this->makeJsonResponse(200, [
                'data' => [
                    ['id' => 'e3'],
                ],
                'paginationCursorNext' => null,
                'hasMore' => false,
            ]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $result = $client->email->search([
            'query' => ['status' => 'delivered'],
            'limit' => 2,
        ]);

        $ids = [];
        foreach ($result->autoPaginate() as $email) {
            $ids[] = $email['id'];
        }

        $this->assertSame(['e1', 'e2', 'e3'], $ids);
        $this->assertCount(2, $fake->requests);
        $this->assertStringEndsWith('/email/search', $fake->requests[0]['url']);
    }

    public function testContactsCrudAndQueryAndList(): void
    {
        $fake = new FakeHttpClient([
            // createOrUpdate
            $this->makeJsonResponse(200, ['ok' => true]),
            // find
            $this->makeJsonResponse(200, ['contact' => ['email' => 'user@example.com']]),
            // query: two pages
            $this->makeJsonResponse(200, [
                'data' => [['email' => 'a@example.com'], ['email' => 'b@example.com']],
            ]),
            $this->makeJsonResponse(200, [
                'data' => [['email' => 'c@example.com']],
            ]),
            // list: cursor-based
            $this->makeJsonResponse(200, [
                'data' => [['email' => 'x@example.com']],
                'paginationCursorNext' => 'next',
                'hasMore' => true,
            ]),
            $this->makeJsonResponse(200, [
                'data' => [['email' => 'y@example.com']],
                'paginationCursorNext' => null,
                'hasMore' => false,
            ]),
            // delete
            $this->makeJsonResponse(200, ['deleted' => true]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $client->contacts->createOrUpdate([
            'email' => 'user@example.com',
        ]);

        $found = $client->contacts->find('user@example.com');
        $this->assertInstanceOf(Sidemail\Resource::class, $found);
        $this->assertSame('user@example.com', $found->email);

        $queryResult = $client->contacts->query([
            'limit' => 2,
        ]);

        $emails = [];
        foreach ($queryResult->autoPaginate() as $c) {
            $emails[] = $c['email'];
        }
        $this->assertSame(['a@example.com', 'b@example.com', 'c@example.com'], $emails);

        $listResult = $client->contacts->list([
            'limit' => 1,
        ]);

        $listed = [];
        foreach ($listResult->autoPaginate() as $c) {
            $listed[] = $c['email'];
        }
        $this->assertSame(['x@example.com', 'y@example.com'], $listed);

        $deleteResp = $client->contacts->delete('user@example.com');
        $this->assertTrue($deleteResp->deleted);
    }

    public function testMessengerCrudAndList(): void
    {
        $fake = new FakeHttpClient([
            // list (offset)
            $this->makeJsonResponse(200, ['data' => [['id' => 'm1'], ['id' => 'm2']]]),
            $this->makeJsonResponse(200, ['data' => [['id' => 'm3']]]),
            // get
            $this->makeJsonResponse(200, ['id' => 'm1', 'name' => 'Test']),
            // create
            $this->makeJsonResponse(200, ['id' => 'm2', 'name' => 'New']),
            // update
            $this->makeJsonResponse(200, ['id' => 'm2', 'name' => 'Updated']),
            // delete
            $this->makeJsonResponse(200, ['deleted' => true]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $list = $client->messenger->list(['limit' => 2]);
        $ids = [];
        foreach ($list->autoPaginate() as $m) {
            $ids[] = $m['id'];
        }
        $this->assertSame(['m1', 'm2', 'm3'], $ids);

        $m = $client->messenger->get('m1');
        $this->assertSame('m1', $m->id);

        $created = $client->messenger->create(['name' => 'New']);
        $this->assertSame('New', $created->name);

        $updated = $client->messenger->update('m2', ['name' => 'Updated']);
        $this->assertSame('Updated', $updated->name);

        $deleted = $client->messenger->delete('m2');
        $this->assertTrue($deleted->deleted);
    }

    public function testDomainsCrud(): void
    {
        $fake = new FakeHttpClient([
            // list
            $this->makeJsonResponse(200, ['domains' => [['id' => 'd1']]]),
            // create
            $this->makeJsonResponse(200, ['id' => 'd2']),
            // delete
            $this->makeJsonResponse(200, ['deleted' => true]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $list = $client->domains->list();
        $this->assertInstanceOf(Sidemail\Resource::class, $list);

        $created = $client->domains->create(['name' => 'example.com']);
        $this->assertSame('d2', $created->id);

        $deleted = $client->domains->delete('d2');
        $this->assertTrue($deleted->deleted);
    }

    public function testProjectCrud(): void
    {
        $fake = new FakeHttpClient([
            // create
            $this->makeJsonResponse(200, ['id' => 'p1']),
            // get
            $this->makeJsonResponse(200, ['id' => 'p1', 'name' => 'Proj']),
            // update
            $this->makeJsonResponse(200, ['id' => 'p1', 'name' => 'Updated']),
            // delete
            $this->makeJsonResponse(200, ['deleted' => true]),
        ]);

        $client = new Sidemail\Sidemail(
            apiKey: 'test-key',
            baseUrl: 'https://example.test',
            timeout: 1.0,
            httpClient: $fake
        );

        $created = $client->project->create(['name' => 'Proj']);
        $this->assertSame('p1', $created->id);

        $got = $client->project->get();
        $this->assertSame('p1', $got->id);

        $updated = $client->project->update(['name' => 'Updated']);
        $this->assertSame('Updated', $updated->name);

        $deleted = $client->project->delete();
        $this->assertTrue($deleted->deleted);
    }
}
