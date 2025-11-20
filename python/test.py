import base64
from unittest.mock import Mock

import pytest

from sidemail import (
    Sidemail,
    SidemailError,
    SidemailAuthError,
    SidemailAPIError,
)

from sidemail.client import (
    _Config,
    _handle,
    _safe_attr,
    _wrap_any,
    Resource,
    offset_query,
    cursor_query,
    QueryResult,
    _EmailAPI,
    _ContactsAPI,
    _MessengerAPI,
    _DomainsAPI,
    _ProjectAPI,
)


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text="", content=b"{}"):
        self.status_code = status_code
        self._json_data = json_data
        self.text = text
        # make content truthy by default so _handle goes down the JSON path
        self.content = content if content is not None else b"{}"

    def json(self):
        if self._json_data is None:
            raise ValueError("No JSON data")
        return self._json_data


@pytest.fixture
def cfg():
    return _Config(api_key="test-key", base_url="https://example.test", timeout=5.0)


@pytest.fixture
def mock_client():
    return Mock()


# -------------------------
# Basic helpers
# -------------------------


def test_safe_attr():
    assert _safe_attr("class") == "class_"
    assert _safe_attr("normal") == "normal"
    assert _safe_attr("1abc") == "1abc_"  # not identifier


def test_wrap_any_mapping_and_list():
    mapping_value = {"SomeKey": 1}
    wrapped = _wrap_any(mapping_value)
    assert isinstance(wrapped, Resource)

    list_value = [{"k": 1}, {"k": 2}]
    wrapped_list = _wrap_any(list_value)
    assert isinstance(wrapped_list, list)
    assert isinstance(wrapped_list[0], Resource)


# -------------------------
# Resource
# -------------------------


def test_resource_dot_access_and_to_dict():
    data = {"firstName": "Ada", "lastName": "Lovelace", "meta": {"createdAt": "now"}}
    res = Resource(data)

    # keys are preserved (camelCase)
    assert res.firstName == "Ada"
    assert res.lastName == "Lovelace"
    assert isinstance(res.meta, Resource)
    assert res.meta.createdAt == "now"

    as_dict = res.to_dict()
    assert as_dict == {
        "firstName": "Ada",
        "lastName": "Lovelace",
        "meta": {"createdAt": "now"},
    }

    # raw should preserve original keys
    assert res.raw == data


def test_resource_missing_attr_raises_attribute_error():
    res = Resource({"foo": 1})
    with pytest.raises(AttributeError):
        _ = res.bar


# -------------------------
# _handle + errors
# -------------------------


def test_handle_success_json():
    resp = FakeResponse(status_code=200, json_data={"ok": True})
    result = _handle(resp)
    # wrapped as Resource
    assert isinstance(result, Resource)
    assert result.ok is True


def test_handle_success_text_fallback():
    resp = FakeResponse(
        status_code=200, json_data=None, text="plain text", content=b"x"
    )

    def bad_json():
        raise ValueError("no json")

    resp.json = bad_json
    result = _handle(resp)
    assert result == "plain text"


def test_handle_auth_error_raises_sidemail_auth_error():
    resp = FakeResponse(
        status_code=401,
        json_data={"developerMessage": "Nope"},
        text="Nope",
        content=b"{}",
    )
    with pytest.raises(SidemailAuthError) as exc:
        _handle(resp)
    assert "Nope" in str(exc.value)


def test_handle_api_error_raises_sidemail_api_error():
    resp = FakeResponse(
        status_code=500,
        json_data={"developerMessage": "Internal error"},
        text="Internal error",
        content=b"{}",
    )
    with pytest.raises(SidemailAPIError) as exc:
        _handle(resp)
    assert exc.value.status == 500
    assert exc.value.payload["developerMessage"] == "Internal error"


# -------------------------
# Pagination helpers
# -------------------------


def test_offset_query_basic():
    pages = [
        {"data": [1, 2, 3]},
        {"data": [4, 5, 6]},
        {"data": []},
    ]

    calls = {"count": 0}

    def fetch_page(offset, limit):
        # ignore offset/limit for simplicity; just step through pages
        idx = calls["count"]
        calls["count"] += 1
        return pages[idx]

    qr = offset_query(fetch_page, start_offset=0, page_size=3, data_key="data")

    assert isinstance(qr, QueryResult)
    assert qr.data == [1, 2, 3]

    all_items = list(qr.auto_paging())
    assert all_items == [1, 2, 3, 4, 5, 6]


def test_cursor_query_basic():
    # simulate two-page cursor pagination
    def fetch_page(next_cursor, prev_cursor, limit):
        if next_cursor is None and prev_cursor is None:
            # first page
            return {
                "data": [1, 2],
                "paginationCursorNext": "next-token",
                "paginationCursorPrev": None,
                "hasMore": True,
                "hasPrev": False,
            }
        if next_cursor == "next-token":
            return {
                "data": [3, 4],
                "paginationCursorNext": None,
                "paginationCursorPrev": "prev-token",
                "hasMore": False,
                "hasPrev": True,
            }
        # fallback
        return {"data": []}

    qr = cursor_query(fetch_page, page_size=2)
    assert qr.data == [1, 2]
    assert qr.has_more is True

    items = list(qr.auto_paging())
    assert items == [1, 2, 3, 4]

    # hit the fallback branch so coverage doesn't treat it as dead
    assert fetch_page("weird-next", "weird-prev", 10) == {"data": []}


# -------------------------
# _EmailAPI
# -------------------------


def test_email_send_uses_post_no_transform(cfg, mock_client):
    mock_client.post.return_value = FakeResponse(200, json_data={"ok": True})
    api = _EmailAPI(cfg, mock_client)

    result = api.send(customField="value")
    mock_client.post.assert_called_once()
    _, kwargs = mock_client.post.call_args

    assert kwargs["json"]["customField"] == "value"
    assert isinstance(result, Resource)
    assert result.ok is True


def test_email_get_returns_email_field(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"email": {"id": "123", "subject": "Hi"}},
    )
    api = _EmailAPI(cfg, mock_client)

    result = api.get("123")
    assert result["subject"] == "Hi"


def test_email_delete_uses_delete(cfg, mock_client):
    mock_client.delete.return_value = FakeResponse(200, json_data={"deleted": True})
    api = _EmailAPI(cfg, mock_client)

    result = api.delete("123")
    mock_client.delete.assert_called_once()
    assert result.deleted is True


def test_email_search_uses_cursor_query(cfg, mock_client):
    # simulate one-page cursor response
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={
            "data": [{"id": "1"}, {"id": "2"}],
            "paginationCursorNext": None,
            "paginationCursorPrev": None,
            "hasMore": False,
            "hasPrev": False,
        },
    )
    api = _EmailAPI(cfg, mock_client)

    qr = api.search(status="sent", limit=2)
    assert isinstance(qr, QueryResult)
    assert [item["id"] for item in qr.data] == ["1", "2"]


# -------------------------
# _ContactsAPI
# -------------------------


def test_contacts_create_or_update(cfg, mock_client):
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={"contact": {"emailAddress": "a@example.com"}},
    )
    api = _ContactsAPI(cfg, mock_client)

    result = api.create_or_update(emailAddress="a@example.com", firstName="Ada")
    mock_client.post.assert_called_once()
    _, kwargs = mock_client.post.call_args
    # camelized keys
    assert kwargs["json"]["emailAddress"] == "a@example.com"
    assert kwargs["json"]["firstName"] == "Ada"
    assert result.contact.emailAddress == "a@example.com"


def test_contacts_find(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"contact": {"emailAddress": "a@example.com"}},
    )
    api = _ContactsAPI(cfg, mock_client)
    result = api.find("a@example.com")
    assert result.emailAddress == "a@example.com"


def test_contacts_query_uses_offset_pagination(cfg, mock_client):
    # single page
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={"data": [{"emailAddress": "a@example.com"}]},
    )
    api = _ContactsAPI(cfg, mock_client)
    qr = api.query(limit=10)
    assert len(qr.data) == 1
    assert qr.data[0].emailAddress == "a@example.com"


def test_contacts_list_uses_cursor_pagination(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={
            "data": [{"emailAddress": "a@example.com"}],
            "paginationCursorNext": None,
            "paginationCursorPrev": None,
            "hasMore": False,
            "hasPrev": False,
        },
    )
    api = _ContactsAPI(cfg, mock_client)
    qr = api.list(limit=10)
    assert len(qr.data) == 1
    assert qr.data[0].emailAddress == "a@example.com"


def test_contacts_delete(cfg, mock_client):
    mock_client.delete.return_value = FakeResponse(200, json_data={"deleted": True})
    api = _ContactsAPI(cfg, mock_client)

    result = api.delete("a@example.com")
    assert result.deleted is True
    mock_client.delete.assert_called_once()


# -------------------------
# _MessengerAPI
# -------------------------


def test_messenger_list_uses_offset_query(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"data": [{"id": "m1"}]},
    )
    api = _MessengerAPI(cfg, mock_client)

    qr = api.list(limit=5)
    assert [m["id"] for m in qr.data] == ["m1"]


def test_messenger_get(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"id": "m1", "name": "Messenger"},
    )
    api = _MessengerAPI(cfg, mock_client)

    result = api.get("m1")
    assert result.id == "m1"


def test_messenger_create(cfg, mock_client):
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={"id": "m1", "name": "My Messenger"},
    )
    api = _MessengerAPI(cfg, mock_client)

    result = api.create(name="My Messenger")
    mock_client.post.assert_called_once()
    assert result.name == "My Messenger"


def test_messenger_update(cfg, mock_client):
    mock_client.patch.return_value = FakeResponse(
        200,
        json_data={"id": "m1", "name": "Updated"},
    )
    api = _MessengerAPI(cfg, mock_client)

    result = api.update("m1", name="Updated")
    mock_client.patch.assert_called_once()
    assert result.name == "Updated"


def test_messenger_delete(cfg, mock_client):
    mock_client.delete.return_value = FakeResponse(200, json_data={"deleted": True})
    api = _MessengerAPI(cfg, mock_client)

    result = api.delete("m1")
    assert result.deleted is True


# -------------------------
# _DomainsAPI
# -------------------------


def test_domains_list(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"data": [{"id": "d1", "name": "example.com"}]},
    )
    api = _DomainsAPI(cfg, mock_client)

    result = api.list()
    assert result.data[0].name == "example.com"


def test_domains_create(cfg, mock_client):
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={"id": "d1", "name": "example.com"},
    )
    api = _DomainsAPI(cfg, mock_client)

    result = api.create(name="example.com")
    mock_client.post.assert_called_once()
    assert result.name == "example.com"


def test_domains_delete(cfg, mock_client):
    mock_client.delete.return_value = FakeResponse(200, json_data={"deleted": True})
    api = _DomainsAPI(cfg, mock_client)

    result = api.delete("d1")
    assert result.deleted is True


# -------------------------
# _ProjectAPI
# -------------------------


def test_project_create(cfg, mock_client):
    mock_client.post.return_value = FakeResponse(
        200,
        json_data={"id": "p1", "name": "My Project"},
    )
    api = _ProjectAPI(cfg, mock_client)

    result = api.create(name="My Project")
    assert result.name == "My Project"


def test_project_get(cfg, mock_client):
    mock_client.get.return_value = FakeResponse(
        200,
        json_data={"id": "p1", "name": "My Project"},
    )
    api = _ProjectAPI(cfg, mock_client)

    result = api.get()
    assert result.name == "My Project"


def test_project_update(cfg, mock_client):
    mock_client.patch.return_value = FakeResponse(
        200,
        json_data={"id": "p1", "name": "Updated Project"},
    )
    api = _ProjectAPI(cfg, mock_client)

    result = api.update(data={"name": "Updated Project"})
    assert result.name == "Updated Project"


def test_project_delete(cfg, mock_client):
    mock_client.delete.return_value = FakeResponse(200, json_data={"deleted": True})
    api = _ProjectAPI(cfg, mock_client)

    result = api.delete()
    assert result.deleted is True


def test_sidemail_requires_api_key(monkeypatch):
    monkeypatch.delenv("SIDEMAIL_API_KEY", raising=False)
    with pytest.raises(SidemailError):
        Sidemail()


def test_sidemail_reads_api_key_from_env(monkeypatch):
    monkeypatch.setenv("SIDEMAIL_API_KEY", "env-key")
    client = Sidemail()
    assert client._cfg.api_key == "env-key"


def test_sidemail_send_email_delegates_to_email():
    client = Sidemail(api_key="key")
    stub = Mock()
    client.email = stub

    client.send_email(1, foo="bar")
    stub.send.assert_called_once_with(1, foo="bar")


def test_file_to_attachment_encodes_base64():
    data = b"hello"
    attachment = Sidemail.file_to_attachment("hello.txt", data)
    assert attachment["name"] == "hello.txt"
    assert attachment["content"] == base64.b64encode(data).decode("ascii")


def test_handle_success_no_content_returns_none():
    # 2xx, but no body at all -> the "return None" branch
    resp = FakeResponse(status_code=204, json_data=None, text="", content=b"")
    result = _handle(resp)
    assert result is None


def test_handle_error_non_json_fallback_uses_text():
    # non-2xx, json() fails -> fallback payload using resp.text
    resp = FakeResponse(
        status_code=500,
        json_data=None,  # this makes FakeResponse.json() raise ValueError
        text="Server exploded",
        content=b"",
    )

    with pytest.raises(SidemailAPIError) as exc:
        _handle(resp)

    err = exc.value
    assert "Server exploded" in str(err)
    assert err.payload["developerMessage"] == "Server exploded"


# (Removed) camelize-related behavior is no longer part of the SDK


def test_resource_to_dict_handles_list_of_resources():
    data = {"items": [{"id": 1}, {"id": 2}]}
    res = Resource(data)

    as_dict = res.to_dict()
    assert as_dict == {"items": [{"id": 1}, {"id": 2}]}


def test_query_result_iter_first_page_and_repr():
    first_page = {"data": [{"x": 1}, {"x": 2}], "total": 2}

    qr = QueryResult(
        first_page,
        data_key="data",
        fetch_next=lambda: (None, False),
        has_more=False,
    )

    # __iter__
    assert list(iter(qr)) == [{"x": 1}, {"x": 2}]

    # first_page()
    assert qr.first_page() == first_page

    # __repr__ (just smoke-test the formatting)
    rep = repr(qr)
    assert "items=2" in rep
    assert "has_more=False" in rep


def test_offset_query_fetch_next_early_stop_branch():
    # First page returns fewer than page_size items, so internal fetch_next
    # should early-return (None, False) without calling fetch_page again.
    calls = {"count": 0}

    def fetch_page(offset, limit):
        calls["count"] += 1
        # first call (offset 0) returns a single item
        if offset == 0:
            return {"data": [1]}
        # any other call goes through the "no more data" path
        return {"data": []}

    qr = offset_query(fetch_page, start_offset=0, page_size=2, data_key="data")

    # has_more is False, because first page < page_size
    assert qr.has_more is False

    nxt, more = qr._fetch_next()  # exercise the early-return branch
    assert nxt is None
    assert more is False
    assert calls["count"] == 1  # fetch_page not called again by offset_query

    # call fetch_page directly with a non-zero offset to cover the fallback
    assert fetch_page(5, 2) == {"data": []}
    assert calls["count"] == 2


def test_cursor_query_handles_missing_next_cursor_gracefully():
    # has_more=True but no paginationCursorNext: triggers the
    # "if not next_cur: return None, False" path and the "not Mapping" branch
    # in auto_paging.
    calls = {"count": 0}

    def fetch_page(next_cursor, prev_cursor, limit):
        calls["count"] += 1
        # Only the first call should ever happen
        return {
            "data": [1],
            "paginationCursorNext": None,
            "paginationCursorPrev": None,
            "hasMore": True,
            "hasPrev": False,
        }

    qr = cursor_query(fetch_page, page_size=1)

    items = list(qr.auto_paging())
    assert items == [1]
    assert calls["count"] == 1  # no second fetch, branch short-circuits


def test_cursor_query_prev_iteration_uses_prev_cursor():
    # Exercise auto_paging_prev and the full fetch_prev path.
    def fetch_page(next_cursor, prev_cursor, limit):
        if next_cursor is None and prev_cursor == "p2":
            # First "previous" page
            return {
                "data": [3, 4],
                "paginationCursorNext": None,
                "paginationCursorPrev": "p1",
                "hasMore": False,
                "hasPrev": True,
            }
        if next_cursor is None and prev_cursor == "p1":
            # Older previous page
            return {
                "data": [1, 2],
                "paginationCursorNext": None,
                "paginationCursorPrev": None,
                "hasMore": False,
                "hasPrev": False,
            }
        # purely defensive; should never be hit
        raise AssertionError(  # pragma: no cover
            f"Unexpected fetch_page call: {next_cursor}, {prev_cursor}, {limit}"
        )

    qr = cursor_query(fetch_page, start_cursor_prev="p2", page_size=2)

    # First page is from prev_cursor="p2"
    assert qr.data == [3, 4]
    assert qr.has_prev is True

    # Now walk backwards using auto_paging_prev, which
    # will hit the fetch_prev branch and iterate items from "p1".
    prev_items = list(qr.auto_paging_prev())
    assert prev_items == [1, 2]


def test_email_search_passes_pagination_cursors(cfg, mock_client):
    captured_json = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured_json["payload"] = json
        # Single empty page; we only care about the request payload.
        return FakeResponse(
            200,
            json_data={
                "data": [],
                "paginationCursorNext": None,
                "paginationCursorPrev": None,
                "hasMore": False,
                "hasPrev": False,
            },
        )

    mock_client.post.side_effect = fake_post
    api = _EmailAPI(cfg, mock_client)

    api.search(
        status="sent",
        paginationCursorNext="NEXT",
        paginationCursorPrev="PREV",
        limit=10,
    )

    payload = captured_json["payload"]
    assert payload["status"] == "sent"
    assert payload["limit"] == 10
    # these exercise the branches that set paginationCursorNext/Prev
    assert payload["paginationCursorNext"] == "NEXT"
    assert payload["paginationCursorPrev"] == "PREV"


def test_contacts_list_passes_pagination_cursors(cfg, mock_client):
    captured_params = {}

    def fake_get(url, headers=None, params=None, timeout=None):
        captured_params["params"] = params
        return FakeResponse(
            200,
            json_data={
                "data": [],
                "paginationCursorNext": None,
                "paginationCursorPrev": None,
                "hasMore": False,
                "hasPrev": False,
            },
        )

    mock_client.get.side_effect = fake_get
    api = _ContactsAPI(cfg, mock_client)

    api.list(paginationCursorNext="NEXT", paginationCursorPrev="PREV", limit=10)

    params = captured_params["params"]
    assert params["limit"] == 10
    assert params["paginationCursorNext"] == "NEXT"
    assert params["paginationCursorPrev"] == "PREV"


def test_cursor_query_prev_without_cursor_returns_none():
    calls = {"count": 0}

    # First page has has_prev=True but no paginationCursorPrev,
    # so prev_cur stays None internally.
    def fetch_page(next_cursor, prev_cursor, limit):
        calls["count"] += 1
        assert next_cursor is None
        assert prev_cursor is None
        return {
            "data": [],  # no data
            "hasMore": False,
            "hasPrev": True,  # tells cursor_query "there is previous"
            # importantly, no "paginationCursorPrev" key
        }

    qr = cursor_query(fetch_page, page_size=2)

    # has_prev is True, but internal prev_cur is None
    assert qr.has_prev is True

    # This will call the inner fetch_prev, which hits:
    #   if not prev_cur: return None, False  (line 340)
    # and then auto_paging_prev will see prv is not a Mapping,
    # so it hits line 257 and returns.
    items = list(qr.auto_paging_prev())
    assert items == []
    assert calls["count"] == 1


def test_query_result_auto_paging_prev_empty_items():
    def fetch_prev():
        # Mapping but no "data" → items list is empty
        return {}, False

    qr = QueryResult(
        first_page={"data": []},
        data_key="data",
        fetch_next=None,
        fetch_prev=fetch_prev,
        has_more=False,
        has_prev=True,
    )

    # This will:
    # - call fetch_prev() → prv is {} (a Mapping), has_prev becomes False
    # - items = prv.get("data") or [] → []
    # - hit "if not items: return" (line 260)
    items = list(qr.auto_paging_prev())
    assert items == []
