# 工具契约

状态：当前有效｜基线日期：2026-11-12｜权威策略：[ADR-0004](../adr/0004-tool-contract-authority.md)

## 权威与复用规则

- **REST 线上协议权威**：上游快照 [api-contract.json](../../test/_shared/upstream/weknora/api-contract.json)（WeKnora commit `cbdcebabf48c5ee2d6868b370326aa8341703f62`）。本文只描述映射与语义，不复制其请求样本。
- **MCP schema 权威**：实现时工具 `inputSchema`/`outputSchema` 在工具注册处定义一次；本文是其 v1 规范说明，由契约测试锚定一致。
- 鉴权：`apiKey` → `X-API-Key`；`tenantId` 存在时 → `X-Tenant-ID`。`apiKey` 可省略（支持免鉴权部署），不代表任意部署允许匿名。
- 除 `ask` 会话标题前缀（见[差异台账](upstream-sync.md#有意差异台账)）外，REST 请求字段与上游语义一致。

## 工具注册表

| 工具 | 用途 | REST 能力 | 默认 |
| --- | --- | --- | --- |
| `weknora_list_knowledge_bases` | 报告凭据可见知识库，辅助缩小检索 | retrieve | 开 |
| `weknora_search` | 语义片段检索 + 按标题/文件名增强 | retrieve | 开 |
| `weknora_read_document` | 按分块索引拼接文档正文，可分页 | retrieve | 开 |
| `weknora_ask` | 服务端 RAG/Agent 问答，可续聊 | retrieve + chat | 开 |

Skill 使用策略：优先 `search` 定位、`read_document` 补上下文；仅当需要综合结论/生成答案时用 `ask`；追问传回 `session_id`。

---

## `weknora_list_knowledge_bases`

**输入 schema**

```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```

**结构化输出字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `count` | integer | 返回条数。 |
| `knowledge_bases[]` | object[] | 每项 `{ id, name, description }`，均为 string（缺失容错为空串）。 |

**REST 映射**：`GET /api/v1/knowledge-bases`（无 body）。

**行为**：只读、幂等；同时是"全部可见库"范围的解析来源（见[范围解析](#范围解析)）。

---

## `weknora_search`

**输入 schema**

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search text." },
    "knowledge_base_ids": { "type": "array", "items": { "type": "string" }, "description": "Restrict retrieval to these knowledge base ids." },
    "knowledge_ids": { "type": "array", "items": { "type": "string" }, "description": "Restrict the search to these document ids." },
    "max_results": { "type": "integer", "description": "Maximum passages to return; capped by configured maxResults." }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

`query` 必须是非空字符串（trim 后）。`max_results` 仅能收窄，不能超过配置 `maxResults`。

**结构化输出字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 回显 trim 后的查询。 |
| `knowledge_base_ids` | string[] | 本次实际解析出的检索范围（用于解释结果来源）。 |
| `count` | integer | 片段命中数。 |
| `results[]` | object[] | 见下表。 |
| `documents[]` | object[] | 按标题/文件名命中的补充文档，已过滤范围并去重。 |

`results[]` 每项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rank` | integer | 1 起的排序位。 |
| `chunk_id` | string | 片段 id。 |
| `knowledge_id` | string | 文档 id（供 `read_document`）。 |
| `document` | string | 展示名：标题 → 文件名 → id → `(untitled)`。 |
| `chunk_index` | integer | 分块索引；未知为 `-1`。 |
| `score` | number | 相关性分数；非法值容错为 `0`（保持 JSON 有损安全）。 |
| `content` | string | 片段正文，按 `maxChunkChars` 截断。 |
| `truncated` | boolean | 正文是否被截断。 |

`documents[]` 每项：`{ knowledge_id, title, knowledge_base_id, knowledge_base }`。

**REST 映射**（并行）：

1. `POST /api/v1/knowledge-search`，body `{ query, knowledge_base_ids }`（解析后的范围）；
2. `GET /api/v1/knowledge/search?keyword=<query>&limit=<limit>`（按名增强；失败退化为 `[]`，不阻断主结果）。

**行为**：

- 片段结果在插件侧按 `limit` 截取，再投影/截断。
- 按名搜索跨租户可见库，插件按本次范围（KB ids 或文档 ids）过滤，并剔除已由片段命中的文档。
- 解析后范围为空（凭据看不到任何库且未传文档 ids）时，在插件侧以可行动错误失败（指明是凭据范围问题，而非传输错误）。

---

## `weknora_read_document`

**输入 schema**

```json
{
  "type": "object",
  "properties": {
    "knowledge_id": { "type": "string", "description": "Document id, as returned in a search hit." },
    "page": { "type": "integer", "description": "Page of passages, starting at 1." },
    "page_size": { "type": "integer", "description": "Passages per page (max 100)." }
  },
  "required": ["knowledge_id"],
  "additionalProperties": false
}
```

**结构化输出字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `knowledge_id` | string | 文档 id。 |
| `title` | string | 第一页元数据标题；增强失败为空串。 |
| `summary` | string | 第一页元数据摘要（按 `maxChunkChars` 截断）；增强失败为空串。 |
| `page` / `page_size` | integer | 实际页/页大小（默认 1 / 20；`page` 上限 10000、`page_size` 上限 100，非法值回退默认）。 |
| `total_chunks` | integer | 文档总分块数（来自分页响应）。 |
| `returned_chunks` | integer | 本页返回分块数。 |
| `has_more` | boolean | 是否还有下一页。 |
| `truncated` | boolean | 拼接正文是否触及字符预算。 |
| `content` | string | 分块按 `chunk_index` 升序拼接的正文。 |

**REST 映射**：

1. `GET /api/v1/chunks/{knowledge_id}?page=<page>&page_size=<page_size>`；
2. 仅第一页并行补读 `GET /api/v1/knowledge/{knowledge_id}`（标题/摘要增强；失败退化为空串，不阻断正文）。

#### 分页与截断（v1 语义）

- 默认第 1 页、每页 20 块；`page` 上限 10000，`page_size` 上限 100。
- 单次拼接正文预算为 `maxChunkChars × min(本页分块数, 10)`（至少 1 倍、至多 10 倍）；超出即截断并置 `truncated=true`。
- **不承诺无损原文件全文**：逐页续读不能恢复页内被字符预算截断的内容；需要完整细节时应缩小 `page_size` 或改用更精确的 `search` 片段。

---

## `weknora_ask`

**输入 schema**

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "The question to answer." },
    "knowledge_base_ids": { "type": "array", "items": { "type": "string" }, "description": "Restrict retrieval to these knowledge base ids." },
    "agent_id": { "type": "string", "description": "Custom agent id; selects the server-side ReAct pipeline." },
    "session_id": { "type": "string", "description": "Continue an earlier WeKnora session instead of starting one." },
    "web_search": { "type": "boolean", "description": "Let WeKnora also search the web, when its deployment allows it. Default false." }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

**结构化输出字段**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `answer` | string | WeKnora 生成的答案（trim 后）。 |
| `session_id` | string | 可续聊会话 id（以流中返回为准）。 |
| `pipeline` | string | `"rag"` 或 `"agent"`。 |
| `tool_calls[]` | string[] | 服务端报告的工具名。 |
| `references[]` | object[] | 每项 `{ knowledge_id, document, chunk_index, content }`；`content` 按 `maxChunkChars` 截断，条数上限 `maxResults`。 |

**REST 映射**：

1. 无 `session_id` 时先 `POST /api/v1/sessions`，body `{ "title": "weknora: <query 摘要>" }`（标题截断 60 字符；前缀为有意差异）。
2. RAG 路径：`POST /api/v1/knowledge-chat/{session_id}`，body `{ query, channel: "api", knowledge_base_ids }`。
3. Agent 路径（`agent_id` 来自参数或配置默认）：`POST /api/v1/agent-chat/{session_id}`，body `{ query, channel: "api", agent_id, agent_enabled: true }`，仅当 `web_search=true` 时加 `web_search_enabled: true`。
4. 响应为 SSE 流；聚合 `answer`、`references`、`tool_call`、`session_id`；`error` 事件即失败；必须有 `complete` 才成功。

**副作用**：创建或更新服务端会话；Agent 可能执行服务端配置的工具；`web_search=true` 可能访问部署外信息。注解见[运行架构](architecture.md#mcp-注解与副作用)。

**范围行为**：

- RAG：无显式范围时按[范围解析](#范围解析)得到显式列表；为空则在插件侧拒绝（凭据看不到任何库）。
- 自定义 Agent：服务端按其 KBSelectionMode 自选范围；调用显式传库或配置默认仍会覆盖其选择。`agentId` 的可用性与权限由服务端配置约束。
- `web_search` 默认 `false`；部署不支持时由服务端拒绝或忽略，插件不静默改写。

---

## 范围解析

仅适用于检索与 RAG 问答（`search`、`ask` RAG 路径）；按 ID 阅读不受默认列表拦截：

```text
调用参数 knowledge_base_ids
  └─ 非空 → 使用之
配置 knowledgeBaseIds
  └─ 非空 → 使用之
调用参数 knowledge_ids（仅 search）
  └─ 非空 → 直接按文档检索（不展开库列表）
列出凭据可见的全部知识库
  └─ 作为最终范围
```

- `knowledgeBaseIds` 是**可覆盖的检索默认，不是权限白名单**；权限边界在服务端凭据/Agent 配置。
- `read_document` 按 `knowledge_id` 直接读取，不受配置默认列表限制。
- 解析后仍为空（无可见库且无文档 ids）时，工具以指明凭据范围问题的错误失败。

## 缓存

| 缓存 | 生命周期 | 失效 |
| --- | --- | --- |
| 可见全部知识库 id 列表 | 每进程首次解析后复用 | 解析失败立即清除，允许下次调用重试；成功后不主动刷新（新增知识库通常需重启进程） |
| public 资源模式降级状态 | 每客户端实例粘性 | 仅进程重启 |
| 无其他持久缓存 | — | v1 不落盘缓存 |

## 资源链接模式

- 默认 `resourceUrls: "public"`：请求带 `resource_urls=public`，答案/引用返回可直接加载的链接。
- 仅当响应为 **HTTP 403 且错误信息明确包含 `resource_urls=public`** 时，该客户端实例降级为 handle 模式（后续请求不再带该参数），不是任意 403 都降级。
- 承诺文本与链接可用；不承诺各客户端图片内联显示。

## 截断与预算汇总

| 预算 | 默认 | 作用 |
| --- | --- | --- |
| `maxResults` | 8 | 搜索片段数、`ask` 引用条数上限；`max_results` 参数只能收窄。 |
| `maxChunkChars` | 1200 | 单片段/单引用字符预算；阅读拼接预算按本页分块数放大，至多 10 倍。 |
| `requestTimeoutMs` | 30000 | 非流式 REST 请求。 |
| `chatTimeoutMs` | 300000 | 整个问答 SSE 流。 |

所有截断必须通过 `truncated` 标记或分页字段显式呈现；正文渲染不得声称"完整原文"。
