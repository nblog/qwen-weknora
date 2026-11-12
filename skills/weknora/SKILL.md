---
name: weknora
description: Retrieve, read, and ask questions over a configured WeKnora deployment through its MCP tools.
---

# WeKnora knowledge workflow

1. Discover the actual WeKnora MCP tool names in the current client before calling them. The server registers `weknora_list_knowledge_bases`, `weknora_search`, `weknora_read_document`, and `weknora_ask`; a client may add its own MCP namespace prefix.
2. Start with `weknora_search` to locate relevant passages. Use `knowledge_base_ids` only after checking availability or when the task explicitly narrows the scope; use `knowledge_ids` to restrict a follow-up search to selected documents.
3. Use `weknora_read_document` when a hit needs surrounding context. Provide its `knowledge_id`, then page with `page` and `page_size`. Respect `has_more` and `truncated`: reduce `page_size` or search more specifically rather than assuming the page is the full original file.
4. Use `weknora_ask` only for broad synthesis or generated answers that would require combining many passages. It creates or updates a server-side WeKnora session and a configured server-side agent may perform additional actions; it is not read-only, idempotent, or pre-authorized.
5. Continue a WeKnora conversation by passing the returned `session_id` to `weknora_ask`. Keep `web_search` false unless the user explicitly asks for information beyond the configured WeKnora deployment.

Do not claim a result is complete when a tool reports `truncated` or `has_more`. Prefer cited passage content over an unverified synthesized answer.
