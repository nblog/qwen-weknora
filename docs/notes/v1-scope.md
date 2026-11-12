# v1 范围与生产契约

状态：当前有效｜基线日期：2026-11-12｜决策依据：[ADR-0001](../adr/0001-portable-plugin-stdio-skill.md)、[ADR-0002](../adr/0002-typescript-node22-prebuilt.md)

## 产品定位

**WeKnora Agent Plugin** 是一个客户端中立的 Agent Plugins 1.0.0 插件，把一个 WeKnora 部署的以下能力暴露给 AI 编码客户端：

1. 列出凭据可见的知识库；
2. 跨知识库/文档的语义检索；
3. 按文档分块阅读（有预算、可分页）；
4. WeKnora 服务端 RAG(Retrieval-Augmented Generation) 或自定义 Agent 问答（可续聊、可选联网）。

RAG 引擎、知识库管理、模型执行与服务端 Agent 全部留在 WeKnora；插件只做协议适配、使用策略与结果投影。首个验证客户端是 Qwen Code 0.27.2（见[客户端兼容说明](client-compatibility.md)）；通用运行时契约不包含任何客户端专属假设。

## 生产命名（客户端中立约束）

| 对象 | v1 取值 | 约束 |
| --- | --- | --- |
| 产品名 | `WeKnora Agent Plugin` | 正式文档、README、manifest 描述使用。 |
| 插件目录/manifest `name`、归档名、npm 包名（未来） | `weknora-agent-plugin` | 符合 Agent Plugins 名称规则；npm 发布前必须保持同名。 |
| npm `bin` 入口 | 无 | stdio 入口由 `mcp.json` `args` 指向 `${PLUGIN_ROOT}/dist/server.js`；不定义 CLI bin，避免安装侧路径假设。 |
| MCP 服务名（`mcp.json` 键） | `weknora` | 客户端工具命名空间（如 `mcp__weknora__weknora_search`）由此派生，属客户端行为。 |
| 工具名 | `weknora_list_knowledge_bases`、`weknora_search`、`weknora_read_document`、`weknora_ask` | v1 固定，不提供可配置前缀。 |
| Skill | `skills/weknora/SKILL.md`，frontmatter `name: weknora` | 标准 Agent Skills 格式。 |
| 会话标题前缀 | `weknora: ` | 相对上游 `dsh: ` 的有意差异（见[上游差异台账](upstream-sync.md#有意差异台账)）。 |
| 配置字段 | 沿用上游中性字段名（`baseUrl`、`apiKey`、`tenantId`、`knowledgeBaseIds`、`agentId`、`maxResults`、`maxChunkChars`、`requestTimeoutMs`、`chatTimeoutMs`、`resourceUrls`、`tools`） | 见 [配置契约](configuration.md)。 |

生产标识、代码/配置字段、工具名与会话前缀**不得包含任何客户端名称**。真实客户端名称只允许出现在真实来源引用、客户端兼容文档与客户端专属测试说明中。

> 本仓库目录名是历史调研名称，不构成生产标识；以上生产命名以本表为准。

## v1 目标

1. 通过 Agent Plugins 1.0.0 官方 schema 的 `plugin.json` 与 `mcp.json`。
2. 一个 Node.js stdio MCP 服务，完成 MCP 初始化、能力协商与工具发现，调用 WeKnora REST `/api/v1`。
3. 一个标准 Skill，指导模型优先 `search`/`read_document`，综合问题才 `ask`，并说明续聊与分页。
4. 四工具全量保留、默认全开，可经配置逐项关闭（至少保留一个）。
5. 本机文件配置（含凭据），不进发布包；缺失/无效配置在启动时明确失败。
6. 预构建归档：解压/安装后无需 `npm install` 或构建即可运行。
7. 分阶段验证：本地 link → 归档/安装产物 → 首个客户端真实进程闭环（确定性模型服务 + mock WeKnora 可复现）。

## 非目标（v1 明确不做）

- 不实现知识库管理、上传、删除、租户/模型管理等 WeKnora 管理操作。
- 不接入 WeKnora 原生远程 MCP 端点或 Python `mcp-server`；不做双后端、自动探测或降级框架。
- 不支持多部署/多实例配置（单部署；上游 `toolPrefix` 仅作兼容参考，v1 移除该配置项）。
- 不提供客户端专属 manifest、settings、hook、command、agent 或 marketplace 集成。
- 不承诺无损原文件全文（阅读是分块、有预算、可截断的）。
- 不承诺各客户端图片内联显示（承诺文本与链接可用）。
- 不实现系统凭据库、配置向导、自动探测、自动重试编排。
- 不定义 `WEKNORA_*` 环境变量契约；环境继承只是部分客户端的便利行为。
- 不声明未实测客户端的兼容性。

## 通用包结构

发布包（目录或归档）根布局：

```text
weknora-agent-plugin/
├── plugin.json                 # Agent Plugins 1.0.0 manifest；$schema 为官方 1.0.0 canonical ID
├── mcp.json                    # 单 stdio 条目：node ${PLUGIN_ROOT}/dist/server.js --config ${PLUGIN_DATA}/config.json
├── skills/
│   └── weknora/
│       └── SKILL.md            # 检索/阅读/问答策略；不含凭据
├── dist/                       # 预构建 JavaScript 运行文件（含 SDK 打包产物）
├── schemas/
│   └── config.schema.json      # 配置权威 schema，随包分发供编辑器使用
├── examples/
│   └── config.example.json     # 无真实秘密的配置示例
├── LICENSE                     # 本项目许可证
├── NOTICE                      # 上游 MIT 代码的版权与许可通知（实现阶段落地）
├── README.md                   # 默认英文介绍与 Usage；顶部链接简体中文版
└── README_zh-CN.md             # 简体中文介绍与使用；顶部链接英文版
```

约束：

- `plugin.json` 与 `mcp.json` 的 `$schema` 版本必须一致（均为 Agent Plugins 1.0.0）。
- `command` 为单个可执行 token（`node`）；路径与参数在 `args` 中；不做 shell 包装。
- `PLUGIN_ROOT` 只承载随包分发的只读运行文件；`PLUGIN_DATA` 只承载用户 `config.json`（v1 无其他持久状态）。
- 归档清单排除 `.codex-tracking/`、用户配置、测试快照、`node_modules/`、TypeScript 构建缓存等开发产物。
- 两份 README 均随包分发，顶部互链，并包含安装、配置与开始使用的简短说明；末尾保留 `dsh-weknora` 上游来源。此为 2026-11-12 用户追加的语言与 Usage 要求。

## 兼容承诺

| 承诺等级 | 内容 |
| --- | --- |
| v1 已承诺 | Agent Plugins 1.0.0 包格式；stdio MCP 工具契约；WeKnora REST 基线（上游声明测试版本 0.8.0，实际部署需验证）；Node.js >=22 运行时。 |
| 验证后承诺 | Qwen Code 0.27.2 本地 link 与安装产物闭环（阶段 3 完成后）。 |
| 不承诺 | 其他客户端版本、更早 Qwen 版本、npm/Git 安装路径、真实生产部署兼容性、图片内联显示。 |

上游 README 声明曾验证 WeKnora `0.8.0`；这不等于任意当前部署可用，也不证明对旧版本的兼容。真实部署验证按[验收清单](../checklist/v1-acceptance.md)单列，不阻断本地 mock e2e。

## 交付阶段

见 [v1 交付计划](v1-delivery-plan.md)：文档基线（本阶段）→ 实现 worktree → e2e worktree。每阶段只提交本地分支，不自动合并、不推送。
