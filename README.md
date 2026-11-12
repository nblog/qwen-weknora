# WeKnora Agent Plugin

English | [简体中文](README_zh-CN.md)

A [WeKnora](https://github.com/Tencent/WeKnora) integration built on [Agent Plugins](https://agent-plugins.org/specification).

- Search your knowledge bases.
- Read documents with pagination.
- Ask questions and continue conversations with WeKnora.

## Usage

Requires Node.js 22+, a running WeKnora instance, and an AI client that supports Agent Plugins.

1. Download the [plugin ZIP](https://github.com/nblog/qwen-weknora/raw/refs/heads/main/release/weknora-agent-plugin-0.1.0.zip).
2. Install it with your client. For example, with Qwen Code:

   ```sh
   qwen extensions install ./weknora-agent-plugin-0.1.0.zip
   ```

3. Create `config.json` in the plugin data directory (`PLUGIN_DATA`) assigned by your client:

   ```json
   {
     "baseUrl": "http://localhost:8080",
     "apiKey": "your-weknora-api-key"
   }
   ```

   Replace the URL and API key with your deployment settings. See the [configuration template](examples/config.example.json) for more options.
4. Restart your client and ask it to search or read your knowledge base:

   > Search my knowledge base for the deployment guide.

---

Upstream reference: [dsh-weknora](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)
