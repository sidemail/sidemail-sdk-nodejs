from __future__ import annotations

import keyword
import base64
import os
import httpx

from dataclasses import dataclass
from typing import Any, Dict, Iterator, Mapping, Optional, List, Tuple
from urllib.parse import quote as url_quote

API_ROOT = "https://api.sidemail.io/v1"


class SidemailError(Exception):
    pass


class SidemailAuthError(SidemailError):
    pass


class SidemailAPIError(SidemailError):
    def __init__(self, status: int, payload: Optional[Mapping[str, Any]] = None):
        self.status = status
        self.payload = dict(payload or {})
        super().__init__(
            f"HTTP {status}: {self.payload.get('developerMessage') or 'API error'}"
        )


@dataclass
class _Config:
    api_key: str
    base_url: str = API_ROOT
    timeout: float = 10.0
    user_agent: str = "sidemail-sdk-python/0.1.0"


def _headers(cfg: _Config) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
        "User-Agent": cfg.user_agent,
    }


def _handle(resp: httpx.Response) -> Any:
    if 200 <= resp.status_code < 300:
        if resp.content:
            try:
                parsed = resp.json()
            except ValueError:
                return resp.text
            return _wrap_any(parsed)
        return None
    try:
        payload = resp.json()
    except Exception:
        payload = {"developerMessage": resp.text or "Unknown error"}
    if resp.status_code in (401, 403):
        raise SidemailAuthError(payload.get("developerMessage") or "Unauthorized")
    raise SidemailAPIError(resp.status_code, payload)


def _safe_attr(name: str) -> str:
    return f"{name}_" if (not name.isidentifier() or keyword.iskeyword(name)) else name


def _wrap_any(value: Any) -> Any:
    if isinstance(value, Mapping):
        return Resource(value)  # defined below
    if isinstance(value, list):
        return [_wrap_any(v) for v in value]
    return value


class Resource(dict):
    """Dict with dot-access preserving original (camelCase) keys."""

    def __init__(self, data: Mapping[str, Any]):
        super().__init__()
        object.__setattr__(self, "_raw", dict(data))
        for k, v in data.items():
            key = _safe_attr(str(k))
            super().__setitem__(key, _wrap_any(v))

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as e:
            raise AttributeError(name) from e

    def to_dict(self) -> dict:
        def unwind(v):
            if isinstance(v, Resource):
                return {k: unwind(v[k]) for k in v.keys()}
            if isinstance(v, list):
                return [unwind(x) for x in v]
            return v

        return {k: unwind(v) for k, v in self.items()}

    @property
    def raw(self) -> Mapping[str, Any]:
        return self._raw


class _EmailAPI:
    def __init__(self, cfg: _Config, http: httpx.Client):
        self._cfg = cfg
        self._http = http

    def send(self, **params) -> Dict[str, Any]:
        return _handle(
            self._http.post(
                f"{self._cfg.base_url}/email/send",
                headers=_headers(self._cfg),
                json=dict(params),
                timeout=self._cfg.timeout,
            )
        )

    def search(self, **params) -> QueryResult:
        endpoint_url = f"{self._cfg.base_url}/email/search"
        next_cursor_start = params.pop("paginationCursorNext", None)
        prev_cursor_start = params.pop("paginationCursorPrev", None)
        page_size = params.get("limit")
        base_payload = dict(params)

        def fetch(next_cursor, prev_cursor, limit_):
            payload = dict(base_payload)
            if limit_ is not None:
                payload["limit"] = limit_
            if next_cursor:
                payload["paginationCursorNext"] = next_cursor
            if prev_cursor:
                payload["paginationCursorPrev"] = prev_cursor
            return _handle(
                self._http.post(
                    endpoint_url,
                    headers=_headers(self._cfg),
                    json=payload,
                    timeout=self._cfg.timeout,
                )
            )

        return cursor_query(
            fetch,
            start_cursor_next=next_cursor_start,
            start_cursor_prev=prev_cursor_start,
            page_size=page_size,
        )

    def get(self, email_id: str) -> Optional[Dict[str, Any]]:
        resp = self._http.get(
            f"{self._cfg.base_url}/email/{email_id}",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        out = _handle(resp)
        return out.get("email") if isinstance(out, dict) else out

    def delete(self, email_id: str) -> Dict[str, Any]:
        resp = self._http.delete(
            f"{self._cfg.base_url}/email/{email_id}",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)


class QueryResult:
    def __init__(
        self,
        first_page: Mapping[str, Any],
        *,
        data_key: str,
        fetch_next,  # () -> (page or None, has_more: bool)
        fetch_prev=None,  # () -> (page or None, has_prev: bool)
        has_more: bool,
        has_prev: bool = False,
        next_cursor: Optional[str] = None,
        prev_cursor: Optional[str] = None,
        offset: Optional[int] = None,
        limit: Optional[int] = None,
    ):
        self.page = first_page or {}
        self._data_key = data_key
        self._fetch_next = fetch_next
        self._fetch_prev = fetch_prev

        self.data: List[Dict[str, Any]] = list(self.page.get(data_key) or [])
        self.total: Optional[int] = self.page.get("total")
        self.limit = limit
        self.offset = offset
        self.next_cursor = next_cursor
        self.prev_cursor = prev_cursor
        self.has_more = bool(has_more)
        self.has_prev = bool(has_prev)

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        return iter(self.data)

    def auto_paging(self) -> Iterator[Dict[str, Any]]:
        for item in self.data:
            yield item
        while self.has_more and self._fetch_next:
            nxt, self.has_more = self._fetch_next()
            if not isinstance(nxt, Mapping):
                return
            items = nxt.get(self._data_key) or []
            if not items:
                return
            for it in items:
                yield it

    def auto_paging_prev(self) -> Iterator[Dict[str, Any]]:
        while self.has_prev and self._fetch_prev:
            prv, self.has_prev = self._fetch_prev()
            if not isinstance(prv, Mapping):
                return
            items = prv.get(self._data_key) or []
            if not items:
                return
            for it in items:
                yield it

    def first_page(self) -> Mapping[str, Any]:
        return self.page

    def __repr__(self) -> str:
        return (
            f"<QueryResult items={len(self.data)} has_more={self.has_more} has_prev={self.has_prev} "
            f"offset={self.offset} next_cursor={self.next_cursor!r} prev_cursor={self.prev_cursor!r} limit={self.limit}>"
        )


def offset_query(fetch_page, *, start_offset=0, page_size=None, data_key="data"):
    """
    fetch_page(offset:int, limit:Optional[int]) -> dict with {data_key: [...]}.
    Stops when returned item count < page_size (or page_size is None and an empty page arrives).
    """
    offset = int(start_offset or 0)
    first = fetch_page(offset, page_size) or {}
    first_items = first.get(data_key) or []
    received = len(first_items)

    def fetch_next():
        nonlocal offset, received
        if page_size is not None and received < page_size:
            return None, False
        offset += received
        page = fetch_page(offset, page_size) or {}
        items = page.get(data_key) or []
        received = len(items)
        has_more = bool(page_size is not None and received == page_size)
        return page, has_more

    has_more = bool(page_size is not None and received == page_size)
    return QueryResult(
        first, data_key=data_key, fetch_next=fetch_next, has_more=has_more
    )


def cursor_query(
    fetch_page,  # fetch_page(next_cursor:Optional[str], prev_cursor:Optional[str], limit:Optional[int]) -> Mapping
    *,
    start_cursor_next: Optional[str] = None,
    start_cursor_prev: Optional[str] = None,
    page_size: Optional[int] = None,
    data_key: str = "data",
    next_cursor_key: str = "paginationCursorNext",
    prev_cursor_key: str = "paginationCursorPrev",
    has_more_key: Optional[str] = "hasMore",
    has_prev_key: Optional[str] = "hasPrev",
) -> QueryResult:
    next_cur = start_cursor_next
    prev_cur = start_cursor_prev

    first = fetch_page(next_cur, prev_cur, page_size) or {}

    next_cur = first.get(next_cursor_key)
    prev_cur = first.get(prev_cursor_key)

    has_more_first = (
        bool(first.get(has_more_key)) if has_more_key else (next_cur is not None)
    )
    has_prev_first = (
        bool(first.get(has_prev_key)) if has_prev_key else (prev_cur is not None)
    )

    def fetch_next() -> Tuple[Optional[Mapping[str, Any]], bool]:
        nonlocal next_cur
        if not next_cur:
            return None, False
        page = fetch_page(next_cur, None, page_size) or {}
        next_cur = page.get(next_cursor_key)
        more = bool(page.get(has_more_key)) if has_more_key else (next_cur is not None)
        return page, more

    def fetch_prev() -> Tuple[Optional[Mapping[str, Any]], bool]:
        nonlocal prev_cur
        if not prev_cur:
            return None, False
        page = fetch_page(None, prev_cur, page_size) or {}
        prev_cur = page.get(prev_cursor_key)
        prev = bool(page.get(has_prev_key)) if has_prev_key else (prev_cur is not None)
        return page, prev

    return QueryResult(
        first,
        data_key=data_key,
        fetch_next=fetch_next,
        fetch_prev=fetch_prev,
        has_more=has_more_first,
        has_prev=has_prev_first,
        next_cursor=first.get(next_cursor_key),
        prev_cursor=first.get(prev_cursor_key),
        offset=None,
        limit=page_size,
    )


class _ContactsAPI:
    def __init__(self, cfg: _Config, http: httpx.Client):
        self._cfg = cfg
        self._http = http

    def create_or_update(self, **params) -> Dict[str, Any]:
        payload = dict(params)
        resp = self._http.post(
            f"{self._cfg.base_url}/contacts",
            headers=_headers(self._cfg),
            json=payload,
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def find(self, email_address: str) -> Optional[Dict[str, Any]]:
        resp = self._http.get(
            f"{self._cfg.base_url}/contacts/{url_quote(email_address, safe='')}",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        out = _handle(resp)
        return out.get("contact") if isinstance(out, dict) else out

    def query(self, **params) -> QueryResult:
        start_offset = int(params.pop("offset", 0) or 0)
        page_size = params.get("limit")
        base_payload = dict(params)

        def fetch_page(off, lim):
            p = dict(base_payload)
            p["offset"] = off
            if lim is not None:
                p["limit"] = lim
            resp = self._http.post(
                f"{self._cfg.base_url}/contacts/query",
                headers=_headers(self._cfg),
                json=p,
                timeout=self._cfg.timeout,
            )
            return _handle(resp)

        return offset_query(fetch_page, start_offset=start_offset, page_size=page_size)

    def list(self, **params) -> QueryResult:
        next_start = params.pop("paginationCursorNext", None)
        prev_start = params.pop("paginationCursorPrev", None)
        page_size = params.get("limit")
        base_payload = dict(params)

        def fetch_page(next_cur, prev_cur, lim):
            p = dict(base_payload)
            if lim is not None:
                p["limit"] = lim
            if next_cur:
                p["paginationCursorNext"] = next_cur
            if prev_cur:
                p["paginationCursorPrev"] = prev_cur
            resp = self._http.get(
                f"{self._cfg.base_url}/contacts",
                headers=_headers(self._cfg),
                params=p,
                timeout=self._cfg.timeout,
            )
            return _handle(resp)

        return cursor_query(
            fetch_page,
            start_cursor_next=next_start,
            start_cursor_prev=prev_start,
            page_size=page_size,
        )

    def delete(self, email_address: str) -> Dict[str, Any]:
        resp = self._http.delete(
            f"{self._cfg.base_url}/contacts/{url_quote(email_address, safe='')}",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)


class _MessengerAPI:
    def __init__(self, cfg: _Config, http: httpx.Client):
        self._cfg = cfg
        self._http = http

    def list(self, **params) -> QueryResult:
        start_offset = int(params.pop("offset", 0) or 0)
        page_size = params.get("limit")
        base = dict(params)

        def fetch_page(off, lim):
            p = dict(base)
            p["offset"] = off
            if lim is not None:
                p["limit"] = lim
            return _handle(
                self._http.get(
                    f"{self._cfg.base_url}/messenger",
                    headers=_headers(self._cfg),
                    params=p,
                    timeout=self._cfg.timeout,
                )
            )

        return offset_query(fetch_page, start_offset=start_offset, page_size=page_size)

    def get(self, messenger_id: str) -> Dict[str, Any]:
        return _handle(
            self._http.get(
                f"{self._cfg.base_url}/messenger/{messenger_id}",
                headers=_headers(self._cfg),
                timeout=self._cfg.timeout,
            )
        )

    def create(self, **params) -> Dict[str, Any]:
        return _handle(
            self._http.post(
                f"{self._cfg.base_url}/messenger",
                headers=_headers(self._cfg),
                json=dict(params),
                timeout=self._cfg.timeout,
            )
        )

    def update(self, messenger_id: str, **params) -> Dict[str, Any]:
        return _handle(
            self._http.patch(
                f"{self._cfg.base_url}/messenger/{messenger_id}",
                headers=_headers(self._cfg),
                json=dict(params),
                timeout=self._cfg.timeout,
            )
        )

    def delete(self, messenger_id: str) -> Dict[str, Any]:
        return _handle(
            self._http.delete(
                f"{self._cfg.base_url}/messenger/{messenger_id}",
                headers=_headers(self._cfg),
                timeout=self._cfg.timeout,
            )
        )


class _DomainsAPI:
    def __init__(self, cfg: _Config, http: httpx.Client):
        self._cfg = cfg
        self._http = http

    def list(self) -> Dict[str, Any]:
        resp = self._http.get(
            f"{self._cfg.base_url}/domains",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def create(self, **params) -> Dict[str, Any]:
        payload = dict(params)
        resp = self._http.post(
            f"{self._cfg.base_url}/domains",
            headers=_headers(self._cfg),
            json=payload,
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def delete(self, domain_id: str) -> Dict[str, Any]:
        resp = self._http.delete(
            f"{self._cfg.base_url}/domains/{domain_id}",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)


class _ProjectAPI:
    def __init__(self, cfg: _Config, http: httpx.Client):
        self._cfg = cfg
        self._http = http

    def create(self, **params) -> Dict[str, Any]:
        payload = dict(params)
        resp = self._http.post(
            f"{self._cfg.base_url}/project",
            headers=_headers(self._cfg),
            json=payload,
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def get(self) -> Dict[str, Any]:
        resp = self._http.get(
            f"{self._cfg.base_url}/project",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def update(self, *, data: Mapping[str, Any]) -> Dict[str, Any]:
        resp = self._http.patch(
            f"{self._cfg.base_url}/project",
            headers=_headers(self._cfg),
            json=dict(data),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)

    def delete(self) -> Dict[str, Any]:
        resp = self._http.delete(
            f"{self._cfg.base_url}/project",
            headers=_headers(self._cfg),
            timeout=self._cfg.timeout,
        )
        return _handle(resp)


class Sidemail:
    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = API_ROOT,
        timeout: float = 10.0,
        session: Optional[httpx.Client] = None,
    ):
        key = api_key or os.getenv("SIDEMAIL_API_KEY")
        if not key:
            raise SidemailError(
                "Missing API key. Pass api_key=... or set SIDEMAIL_API_KEY."
            )
        self._cfg = _Config(api_key=key, base_url=base_url, timeout=timeout)
        self._http = session or httpx.Client()

        # Namespaced APIs for better DX
        self.email = _EmailAPI(self._cfg, self._http)
        self.contacts = _ContactsAPI(self._cfg, self._http)
        self.messenger = _MessengerAPI(self._cfg, self._http)
        self.domains = _DomainsAPI(self._cfg, self._http)
        self.project = _ProjectAPI(self._cfg, self._http)

    # Convenience shortcut
    def send_email(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return self.email.send(*args, **kwargs)

    @staticmethod
    def file_to_attachment(name: str, data: bytes) -> Dict[str, str]:
        return {"name": name, "content": base64.b64encode(data).decode("ascii")}
