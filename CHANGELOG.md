# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-08

### Fixed

- Stop forcing shared keep-alive agents for API requests. The SDK now uses native `fetch` and leaves connection pooling to Node's default fetch behavior.
- Wrap transport and response body read failures in `SidemailError` while preserving the original error as `cause`.

### Added

- Allow passing a custom `fetch` implementation when configuring the SDK.
- Allow passing custom `fetchOptions` when configuring the SDK.
- Allow passing a per-call `signal` to SDK methods.
- Add `sidemail.email.validate()`.
- Add `sidemail.contacts.query()`.
- Add Templates API methods under `sidemail.templates`.
- Add Domains API methods under `sidemail.domains`.
- Add Inbound API methods under `sidemail.inbound`.

### Breaking Changes

- Minimum Node.js version increased from 16.x to 18.x.
- Removed the runtime `node-fetch` dependency.

## [0.2.0] - 2025-11-25

### Breaking Changes

- Minimum Node.js version increased from 8.x to 16.x

### Added

- Auto-pagination support for `contacts.list()` and `email.search()`

## [0.1.7] - Previous releases

- See git history for changes prior to 0.2.0
