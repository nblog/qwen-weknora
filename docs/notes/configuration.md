# 配置契约

状态：当前有效｜基线日期：2026-11-12｜权威策略：[ADR-0003](../adr/0003-config-authority-and-schema.md)

## 权威入口

- 配置文件：**`${PLUGIN_DATA}/config.json`**，由 `mcp.json` stdio 参数 `--config ${PLUGIN_DATA}/config.json` 传入，是唯一权威配置入口。
- 字段/类型/默认值/约束的机器可读权威：[`schemas/config.schema.json`](../../schemas/config.schema.json)（JSON Schema Draft 2020-12，随包分发）。
- 无环境变量契约：v1 不读取任何 `WEKNORA_*` 环境变量；客户端继承宿主环境只是便利行为，不能作为跨客户端保证。
- 无系统凭据库、无配置向导、无自动探测。

## 字段总览

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | string（绝对 http/https URL） | `http://localhost:8080/api/v1` | WeKnora API 根地址，必须带非空 hostname；可带或不带 `/api/v1` 后缀，加载时归一（去尾斜杠、补 `/api/v1`）。 |
| `apiKey` | string | 无 | 发送为 `X-API-Key`。省略表示部署不要求鉴权；可能包含真实秘密。 |
| `tenantId` | string | 无 | 发送为 `X-Tenant-ID`；仅平台级 API key 需要。 |
| `knowledgeBaseIds` | string[] | `[]` | 检索默认范围；可被调用参数覆盖；**不是权限白名单**。 |
| `agentId` | string | 无 | `weknora_ask` 默认自定义 Agent；省略使用 RAG 管线。其可用性/权限由服务端约束。 |
| `maxResults` | integer >=1 | `8` | 搜索片段数与 `ask` 引用上限。 |
| `maxChunkChars` | integer >=1 | `1200` | 单片段/单引用字符预算；阅读拼接预算按本页分块数放大，至多 10 倍。 |
| `requestTimeoutMs` | integer >=1 | `30000` | 非流式请求超时。 |
| `chatTimeoutMs` | integer >=1 | `300000` | 问答 SSE 流总超时（含模型/工具时间）。 |
| `resourceUrls` | `"handle" \| "public"` | `"public"` | 资源链接模式；403 特定降级见[工具契约](tools.md#资源链接模式)。 |
| `tools` | object | 四项全 `true` | 工具开关：`listKnowledgeBases`、`search`、`readDocument`、`ask`；至少一个为 `true`。 |
| `$schema` | string | 无 | 可选**编辑器提示**，指向随包的 `schemas/config.schema.json`；运行时忽略该字段且不联网获取。 |

相对上游差异：不提供 `toolPrefix`（v1 固定 `weknora_*` 工具名）；配置来源从 Cordis 行改为文件；数值预算严格拒绝小数/零/负数（[D-06](upstream-sync.md#有意差异台账)）。

## 缺失、无效与启动行为

加载流水线：JSON 解析 → 已声明字符串字段的窄预处理（见下节）→ schema 校验与默认值应用 → 不可变 `ResolvedConfig`。预处理不转换类型、不修复非法结构。

| 情形 | 行为 |
| --- | --- |
| `--config` 参数缺失或多余位置参数 | 启动失败，stderr 给出用法与示例路径，退出码非零。 |
| 配置文件不存在 | 启动失败（**不静默使用默认部署**），stderr 指明路径并提示从 `examples/config.example.json` 复制。 |
| 文件不可读/非法 JSON | 启动失败，stderr 指明路径与解析错误；不写 stdout。 |
| schema 校验失败（类型、`integer >= 1`、URL pattern/format、封闭字段、全部工具关闭等） | 启动失败，stderr 列出全部违规项（字段路径 + 原因），一次性报告而非首个错误。 |
| 部分字段缺省 | 使用 schema 默认值与预处理规则正常启动。 |

失败诊断不回显 `apiKey`/`tenantId` 的值。启动失败时不向 stdout 写任何字节（stdout 保留给 MCP）。

## 预处理与校验规则（按执行顺序）

1. **窄预处理（仅作用于已声明字符串字段，先于 schema）**：可选字符串（`apiKey`、`tenantId`、`agentId`）trim，trim 后为空则从待校验对象中移除（等同未提供）；`baseUrl` trim、去尾部斜杠、不以 `/api/v<digits>` 结尾则追加 `/api/v1`；`knowledgeBaseIds` 元素逐个 trim（trim 后为空的元素保留为空串，由 schema 逐项拒绝）。不做类型转换、键名修复或未知字段清洗。
2. **schema 校验**：数值预算必须本来就是 `integer >= 1`——小数、零、负数一律拒绝，**不向下取整**（相对上游更严格，[D-06](upstream-sync.md#有意差异台账)）；`baseUrl` 必须是带非空 hostname 的绝对 `http`/`https` URL（例如 `https://?`、`https://#`、`https://` 均拒绝）；未知字段由 `additionalProperties: false` 拒绝。
3. **默认值与语义约束**：未提供字段应用 schema `default`；`tools` 未列出的键保持默认 `true`；显式全 `false` 由 schema 的"至少一个工具"分支拒绝。
4. **结果**：构造只读 `ResolvedConfig`，运行期不再变更。

## 目录与凭据边界

| 目录 | 用途 | 约束 |
| --- | --- | --- |
| `PLUGIN_ROOT` | 随包只读运行文件（manifest、Skill、`dist/`、schema、许可证） | 不写任何文件；不存放用户数据或凭据 |
| `PLUGIN_DATA` | 用户 `config.json`（v1 唯一持久内容） | 由客户端创建并可写、跨更新保留；卸载是否删除由客户端决定 |

- `config.json` **永不进入发布归档、构建产物、Git、日志或测试快照**。
- 构建脚本必须以显式清单打包，而不是"全目录复制 + 事后排除"，防止秘密混入。
- 文件系统权限由用户环境负责；README 提示该文件包含凭据，应限制可读范围。

## 示例

[`examples/config.example.json`](../../examples/config.example.json) 是无真实秘密的模板（占位符与 `.example.test` 域名），随包分发。使用方式：

1. 安装/link 插件后，确认客户端给出的 `PLUGIN_DATA` 路径（首个客户端的查询方式见[客户端兼容说明](client-compatibility.md)）。
2. 复制示例为 `${PLUGIN_DATA}/config.json` 并填写 `baseUrl` 与凭据。
3. 示例中的 `"$schema": "../schemas/config.schema.json"` 是**编辑器提示**（相对 `examples/` 指向随包 schema），运行时不读取、不联网获取；复制到 `${PLUGIN_DATA}/config.json` 后相对位置不再成立，应删除该字段或改为指向本机插件包内 schema 的实际路径。

实现阶段的校验测试要求见 [ADR-0003](../adr/0003-config-authority-and-schema.md#决策)。
