# Test overview

Tests are grouped by capability: `config-contract`, `rest-client`, `tool-contract`, `mcp-server`, `package-contract`, `package-e2e`, and `client-e2e`. The last two groups exercise the built release archive; `client-e2e` is the fixed first-client compatibility boundary.

Pinned public schemas, the REST contract fixture, and upstream licenses live in [`_shared/upstream/`](_shared/upstream/README.md). Tests do not read private research directories.

Run from the repository root:

```powershell
npm run package
npm test
```

`npm test` requires the release archive because the package and client end-to-end groups extract and install that exact artifact. Re-run `npm run package` after source or README changes, then run `npm test` again.

The client e2e group uses `npm_execpath` from the documented `npm test` invocation when it must install Qwen Code into its isolated cache. To run that single test with `node --test` instead, set `WEKNORA_E2E_QWEN_CLI` to an existing `@qwen-code/qwen-code` 0.27.2 `cli-entry.js`.
