# v1 验收清单

创建日期：2026-11-12（Asia/Shanghai）。**当前状态：A～D 已通过（含阶段 3 最终安装产物复验）；E 真实部署因无目标仍未执行。**

本清单是 v1 全量验收入口。上游 `dsh-weknora` 的 58 项 mock 测试通过是其自身的验证证据（见 本地私有记录（不随仓库发布）），**不得记作本项目验收通过**。执行后逐项记录：执行日期（ISO 8601）、结果、命令/证据链接；未执行项不得标记通过；后续复验新增记录，不覆盖历史。

## A. 包契约与分发

| ID | 验收项 | 状态 | 执行日期 | 结果/证据 |
| --- | --- | --- | --- | --- |
| A1 | `plugin.json`/`mcp.json` 通过 Agent Plugins 1.0.0 官方 schema 校验；两处 `$schema` 版本一致 | 通过（阶段 2） | 2026-11-12 | `test/package-contract/00-package.test.mjs` 使用固定官方 schema 校验两个 manifest，断言 `$schema` 语义与 stdio 命令。 |
| A2 | 归档清单与 [通用包结构](../notes/v1-scope.md#通用包结构) 一致，不含 `.codex-tracking/`、用户配置、`node_modules/`、构建缓存 | 通过（阶段 2） | 2026-11-12 | `scripts/build-package.ps1` 显式 10 文件白名单；package 测试逐一校验清单、大小、SHA-256，并拒绝 `node_modules/`、`config.json`、`.codex-tracking/`、`test/`。 |
| A3 | 归档在干净目录解压后，无 `npm install`/构建即可由 Node >=22 启动 stdio 服务 | 通过（阶段 2） | 2026-11-12 | package 测试用系统 `tar` 解压归档到空目录，以解压目录为 cwd 启动 `dist/server.js`，完成 MCP initialize 与 `tools/list`，四工具可发现。 |
| A4 | `schemas/config.schema.json` 与 `examples/config.example.json` 随包分发；示例通过 schema 校验 | 通过（阶段 2） | 2026-11-12 | 打包清单包含两个文件；config 测试读取示例并用运行时同一 schema 解析成功。 |
| A5 | 生产标识客户端中立检查：manifest/Skill/配置字段/工具名/会话前缀与代码/示例中无客户端专属命名 | 通过（阶段 2） | 2026-11-12 | package 测试对 manifest、Skill、schema、示例、`package.json` 与 `dist/server.js` 做大小写不敏感客户端专属标识扫描，零命中。 |
| A6 | `NOTICE` 保留上游 MIT 版权与许可声明 | 通过（阶段 2） | 2026-11-12 | `NOTICE` 记录 Tencent WeKnora commit、MIT 版权、许可文本与 bundled npm 依赖版权/许可标识； package 清单测试校验文件哈希。 |

## B. 配置契约

| ID | 验收项 | 状态 | 执行日期 | 结果/证据 |
| --- | --- | --- | --- | --- |
| B1 | 示例与代表性合法样例通过 schema 校验并得到文档声明的默认值/归一化 | 通过（阶段 2） | 2026-11-12 | `test/config-contract/00-config.test.mjs` 验证默认值直接来自 schema、URL 归一、空可选字符串移除与示例解析。 |
| B2 | 缺失 `--config`、文件不存在、非法 JSON、schema 违规、全部工具关闭均以非零码启动失败，stderr 列出可行动违规项 | 通过（阶段 2） | 2026-11-12 | 同上测试覆盖 CLI 用法、缺失/非法文件、多余参数、schema 多违规与全工具关闭。 |
| B3 | 启动失败路径 stdout 为空（无任何非 MCP 字节） | 通过（阶段 2） | 2026-11-12 | CLI 启动失败测试逐例断言 `stdout === ''`。 |
| B4 | 诊断不回显 `apiKey`/`tenantId` 值 | 通过（阶段 2） | 2026-11-12 | CLI 测试使用独立测试值并断言 stderr 不回显； server 错误 redaction 另由实现与 mock 测试覆盖。 |
| B5 | `knowledgeBaseIds` 可被调用参数覆盖，且不拦截按 ID 阅读（非白名单语义） | 通过（阶段 2） | 2026-11-12 | `test/tool-contract/00-rest-and-tools.test.mjs` 断言调用参数覆盖配置默认，且按 `knowledge_id` 阅读不触发知识库列表拦截。 |
| B6 | 代表性配置样例按预期判定：空 `apiKey`/`tenantId`/`agentId` 预处理后等同省略（接受）；`baseUrl` 缺 `/api/v1` 后缀归一后接受；`maxResults` 为 `8.5`/`0`/`-1`/`"8"` 时拒绝（D-06，不取整）；合法整数预算与部分工具关闭接受 | 通过（阶段 2） | 2026-11-12 | config 测试覆盖 8.5/0/-1/字符串数值、URL 与全关； tool/config 测试覆盖合法整数预算与默认工具开关。 |

## C. 协议与工具契约

| ID | 验收项 | 状态 | 执行日期 | 结果/证据 |
| --- | --- | --- | --- | --- |
| C1 | mock REST 断言与上游快照 fixture 一致：路径、查询参数、body 字段、鉴权头；会话标题为 `weknora: `（D-01） | 通过（阶段 2） | 2026-11-12 | `test/tool-contract/00-rest-and-tools.test.mjs` 直接读取固定快照 `api-contract.json` 断言 query/body；会话标题按 D-01 替换；鉴权头由 rest-client 测试覆盖。 |
| C2 | 四工具 `inputSchema`/`outputSchema` 与 [工具契约](../notes/tools.md) 声明一致；结构化字段完整 | 通过（阶段 2） | 2026-11-12 | `test/mcp-server/00-mcp-server.test.mjs` 从实际 `tools/list` 断言四个封闭 schema 的字段与 required； tool 测试断言结构化输出。 |
| C3 | 预构建归档产物（非源码）完成 stdio `initialize`、能力协商、`tools/list` 四工具发现 | 通过（阶段 2） | 2026-11-12 | `test/package-contract/00-package.test.mjs` 在干净解压目录完成 SDK Client initialize/list/call，不依赖 `node_modules/`。 |
| C4 | stdout 仅 MCP 帧；stderr 诊断；取消/超时（request/chat 两档）与 SSE 无 `complete` 断流均失败且不返回部分结果 | 通过（阶段 2） | 2026-11-12 | MCP 测试逐行解析真实子进程 stdout 为 JSON-RPC，并覆盖客户端取消、request/chat 超时与 SSE 断流。 |
| C5 | `toolPrefix` 不在配置 schema/实现中（D-02）；工具名固定 `weknora_*` | 通过（阶段 2） | 2026-11-12 | config 测试断言未知 `toolPrefix` 被拒绝； tool/MCP 测试断言四工具名固定。 |
| C6 | 范围解析、KB 列表缓存失败重试、按名搜索失败降级、第一页元数据失败降级行为符合文档 | 通过（阶段 2） | 2026-11-12 | `test/tool-contract/00-rest-and-tools.test.mjs` 分别覆盖显式/默认/文档范围、缓存失败后重试、按名搜索 500 降级与元数据 500 降级。 |
| C7 | 分页/截断：`page`/`page_size`（默认 1/20；`page` 上限 10000、`page_size` 上限 100）、拼接预算 `maxChunkChars × min(本页分块数, 10)`、`truncated`/`has_more` 标记正确 | 通过（阶段 2） | 2026-11-12 | tool 测试覆盖默认页、分页 envelope、排序、预算截断与 `truncated`/`has_more`；非法/越界参数按契约回退默认/上限。 |
| C8 | 资源模式：默认 `public`；仅 403 且文案含 `resource_urls=public` 时降级 handle 且进程内粘性 | 通过（阶段 2） | 2026-11-12 | `test/rest-client/00-rest-client.test.mjs` 覆盖默认 public、特定 403 降级重试与后续 handle 粘性，另验证无关 403 不降级。 |
| C9 | `ask` 注解：非只读、非幂等、保守 `destructiveHint=true`（后端 Agent 效果不可界定）；`web_search` 默认关闭；`session_id` 续聊路径可用 | 通过（阶段 2） | 2026-11-12 | MCP/tool 测试断言注解、RAG 与 Agent 请求体、`web_search` 条件字段及 `session_id` 续聊。 |

## D. 首个客户端 e2e（阶段 3）

| ID | 验收项 | 状态 | 执行日期 | 结果/证据 |
| --- | --- | --- | --- | --- |
| D1 | 真实客户端进程（固定版本 0.27.2）在隔离用户配置下安装/link 插件并发现工具 | 通过（阶段 3） | 2026-11-12 | `test/client-e2e/00-qwen-install-e2e.test.mjs` 在独立 home/config/plugin-data/cwd 下执行真实 `extensions install <最终 zip>`；`--list-extensions` 发现插件、Skill 与 MCP，`mcp list` 显示 Connected。 |
| D2 | 确定性模型 + mock WeKnora 完成闭环：用户问题 → 模型选择 `weknora_search` → REST 调用 → 结果回到客户端会话 | 通过（阶段 3） | 2026-11-12 | 同上测试记录模型请求上下文与 REST 请求：模型经客户端 deferred `tool_search` 发现命名空间工具，实际调用 `weknora_search`，从工具结果提取 `doc-retrieval-pipeline` 与后端内容后输出。 |
| D3 | 客户端内完成 `weknora_read_document` 分页续读一次 | 通过（阶段 3） | 2026-11-12 | 同上测试：模型先请求 page 1/page size 2，再按返回的 `has_more` 与分页契约请求 page 2；mock REST 记录 `1:2`、`2:2`，最终输出由两页实际工具结果派生。 |
| D4 | 客户端内完成 `weknora_ask` 及一次 `session_id` 追问 | 通过（阶段 3） | 2026-11-12 | 同上测试：首次 `ask` 无 session，工具结果返回 `session-mock-1`；模型从结果提取该 ID 并传入追问；REST 仅创建一次 session，两次 chat 均落到同一路径。 |
| D5 | 测试环境隔离证据（HOME/配置目录/`PLUGIN_DATA` 可重置）与真实模型/真实部署未执行项如实记录 | 通过（阶段 3） | 2026-11-12 | 每次客户端启动显式覆盖 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`QWEN_CODE_HOME` 并使用临时 cwd；测试断言生成文件、插件目录与 PLUGIN_DATA 均在隔离根，结束后移除沙盒并停止本地服务。限制见阶段 3执行记录。 |

## E. 真实部署（可选、不阻断 v1 本地验收）

| ID | 验收项 | 状态 | 执行日期 | 结果/证据 |
| --- | --- | --- | --- | --- |
| E1 | 针对真实 WeKnora 部署完成四工具冒烟（列库、搜索、读文档、ask） | 待执行（无部署目标） | — | — |
| E2 | 真实部署的资源链接模式与凭据范围行为复验 | 待执行（无部署目标） | — | — |

## 2026-11-12 阶段 2 实现执行记录

环境：Windows 11，PowerShell 7，Node.js `v24.22.1`，npm `11.19.1`；仓库分支 `lianping/v1-implementation`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | 通过，退出码 0 | TypeScript 严格模式检查无错误。 |
| `npm run build` | 通过，退出码 0 | 生成 `dist/server.js`（约 1.4 MiB，SDK/校验器 bundled）。 |
| `uvx check-jsonschema --schemafile https://json-schema.org/draft/2020-12/schema schemas/config.schema.json` | 通过，退出码 0 | schema 自身符合 Draft 2020-12。 |
| `uvx check-jsonschema --schemafile schemas/config.schema.json examples/config.example.json` | 通过，退出码 0 | 示例通过权威配置 schema。 |
| `npm run package` | 通过，退出码 0 | 生成 `release/weknora-agent-plugin-0.1.0.zip`，SHA-256 `dd315c39d66834fa178a84f5cec2e660e704ea25d0f1bc30ae18a59fd4eb1282`；清单见同名 `.manifest.json`。 |
| `npm test`（打包后） | 通过，退出码 0 | 30 tests / 30 pass / 0 fail，覆盖 config、REST/SSE、tool、MCP、package 五组。 |
| `npm audit --omit=dev` | 通过，退出码 0 | 0 vulnerabilities。 |
| 首个客户端 0.27.2 隔离 link 最小证明 | 通过（阶段 2 边界） | 本地私有记录（不随仓库发布）：固定 npm 包安装于临时 cache，隔离 `HOME/USERPROFILE/QWEN_CODE_HOME` 后 link，`--list-extensions` 发现 Skill/MCP，`mcp list` 显示 `weknora ... Connected`。 |

限制：D 组完整客户端模型闭环仍待阶段 3；E 组无真实部署目标仍未执行。阶段 2 的首个客户端证明不调用模型，也不证明真实 WeKnora 部署兼容性。

## 2026-11-12 阶段 3 安装产物与客户端 e2e执行记录

环境：Windows 11，PowerShell 7.6.9，Node.js `v24.22.1`，npm `11.19.1`；worktree `v1-e2e`，分支 `lianping/v1-e2e`，基线 `0a4d08f613055a635552a14de8c5587f8fd79d0d`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 生产缺陷修复：非法 `baseUrl` 与 EOF 关闭 | 通过 | `https://?`、`https://#`、`https://` 在权威 schema/配置边界拒绝，实际打包 CLI 非零退出、stdout 为空、诊断不含配置值；EOF 会取消在途 SSE 并干净退出。聚焦回归见 config-contract 与 mcp-server 组。 |
| 独立安装产物 stdio 层 | 通过 | `test/package-e2e/00-installed-stdio-e2e.test.mjs` 解压最终 zip 至干净目录，以官方 MCP 客户端完成 initialize/capabilities/tools/list、四工具调用、分页续读、同 session 追问、取消、请求超时、问答超时与断流。 |
| 首个客户端真实进程闭环 | 通过 | 本地私有记录（不随仓库发布）：固定 Qwen Code `0.27.2` 真实安装最终 zip，确定性 OpenAI-compatible 模型经 `tool_search`/`tool_call` 适配延迟工具发现，search/read 分页/ask 续聊均由实际工具结果与 REST 请求断言闭环。 |
| schema、示例与生产依赖审计 | 通过 | 最终 `schemas/config.schema.json` 通过 Draft 2020-12 meta-schema；示例通过权威 schema；`npm audit --omit=dev` 退出码 0、0 vulnerabilities。 |
| 最终打包与全量测试 | 通过 | `npm run package` 退出码 0 后 `npm test` 退出码 0：35 tests / 35 pass / 0 fail。最终 zip SHA-256 `19ea3af452356dbba3b121f762aa3bf6f06e87768f29784ddadeea5d1faa31ce`（252954 bytes）。 |
| README 收尾 | 通过 | 根 README 改为简短客户端中立介绍，最后一项保留 [dsh-weknora](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora) 上游锚点；该 README 已进入最终 zip 并通过上述复验。 |

限制：E1/E2 无真实部署目标仍未执行；确定性本地模型证明协议闭环，不评估模型能力或答案质量；mock WeKnora 不证明真实部署兼容。Windows 外部 SIGTERM 表现为硬终止，本机覆盖 EOF 取消，POSIX SIGTERM 由平台条件回归覆盖。

## 2026-11-12 Windows 测试自举复验

协调者独立复现 Node `spawnSync('npm', ...)` 在 Windows 返回 `ENOENT` 后，追加仅测试侧修复与真实 miss-path 复验；不覆盖上文历史 35/35 事实：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原缺陷复现 | 通过（确认缺陷） | 本机 `spawnSync('npm', ['--version'])` 返回 `status=null`、`error.code=ENOENT`。 |
| 修复方式 | 通过 | `test/client-e2e/00-qwen-install-e2e.test.mjs` 改为 `process.execPath + resolve(npm_execpath)`，参数保持数组，失败输出 stdout/stderr/launch error；正常入口为 `npm test`，直接单测需 `WEKNORA_E2E_QWEN_CLI`。 |
| 全新本地 prefix 安装 | 通过 | 用同一 JS 入口调用方式安装到 `.tmp-review-cli/cli-2` 与独立 cache，退出码 0、12 packages；包版本核实为 `@qwen-code/qwen-code` `0.27.2`，未修改实现 worktree 缓存或全局安装。 |
| 新客户端真实 e2e | 通过 | 以 `WEKNORA_E2E_QWEN_CLI` 指向 cli-2 后执行 `npm test`，退出码 0，35/35 通过。 |
| 最终产物不变 | 通过 | 仅测试/文档/tracking 变更，zip SHA-256 前后均为 `19ea3af452356dbba3b121f762aa3bf6f06e87768f29784ddadeea5d1faa31ce`。 |

详细命令与结果见 本地私有记录（不随仓库发布）。
## 2026-11-12 用户 README 调整与公开推送前复验

用户在完成本地交付后调整 README，并要求提交到 public 仓库。本轮将已验收实现与协调记录整合到 `main`，保持用户 README 的文字、排版和原始字节不变，重新生成随包 README。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 用户 README 独立提交 | 通过 | `d0f04f4`，仅修改 `README.md`；发布前与原始备份逐字节比较一致。 |
| 生产源码、契约与依赖保持原验收版本 | 通过 | `src/`、`schemas/`、`skills/`、manifest、`package.json` 与 lock 均与 `1f069fb` 无 Git 差异；新旧归档的 `dist/server.js` 字节一致。 |
| 原始 checkout 中构建、打包与完整测试 | 通过 | `npm ci --no-audit --no-fund`、`npm run package`、固定客户端入口下 `npm test` 均退出 0；35 tests / 35 pass / 0 fail / 0 skipped，包含真实客户端安装与确定性模型闭环。 |
| 公开推送准备产物 | 通过 | `release/weknora-agent-plugin-0.1.0.zip`，252936 bytes；SHA-256 `dc657b00f30650a605b6676eb28e9513bb4d8f9c9ac854a7f8f3febeb983f881`；10 个文件均与清单及当前源码匹配。 |

本节追加新的产物与复验事实，不替换上一阶段的历史包哈希；GitHub 仓库创建、推送与可见性在推送后独立核实。准备记录见 本地私有记录（不随仓库发布）。真实 WeKnora 部署及真实模型质量仍不在本次验证范围内。

## 2026-11-12 英文入口、中文版与 Usage 复验

根据用户后续要求，默认 README 改为英文，新增 `README.zh-CN.md`，顶部相互链接；两份文档均提供简短的安装、配置与开始使用步骤，末尾保留上游来源。安装包显式清单同步增加中文版，正式包结构与导航已更新。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 双语入口与配置示例 | 通过 | 英文 `Usage` 与中文使用节齐全；两份配置 JSON 一致；4 个本地语言/模板链接在源码和归档中均可解析。 |
| 双语安装包清单与原文一致性 | 通过 | 归档包含 11 个文件，包括两份 README；所有文件大小、SHA-256 及源码字节匹配，两个上游锚点均位于文档末尾。 |
| 构建与完整复验 | 通过 | `npm run package`（含 typecheck/build）和固定客户端入口下 `npm test` 均退出 0；35 tests / 35 pass / 0 fail / 0 skipped，覆盖真实客户端安装新版归档的闭环。 |
| 新归档校验和 | 通过 | `release/weknora-agent-plugin-0.1.0.zip`，SHA-256 `5156c8e911868f4a162e4ce24743a19ec5e0a1775c2cf6b2ad9f6960d8b25553`。 |

本节只追加本次介绍与分发调整的实际验证；此前各阶段的产物与测试事实保持不变。GitHub About 按用户要求改为基于 Agent Plugins 的 WeKnora 英文介绍，不再强调“中立”。

## 2026-11-12 私有资料排除与干净导出复验

按 [ADR-0005](../adr/0005-private-research-and-public-contracts.md) 排除私有研究目录，仅公开测试必需的上游原始契约与许可证。从不含 `.codex-tracking/` 的 Git 文件树导出到全新目录，执行 `npm ci --no-audit --no-fund`、`npm run package`、固定客户端入口下的 `npm test`：均退出 0，35 tests / 35 pass / 0 fail / 0 skipped。测试完成后该目录仍不存在私有研究目录。

公开文档本地链接已独立检查，共 149 个可解析；测试 schema 与 REST fixture 的原始校验和、来源和许可证由公开契约目录维护。本次只调整测试输入位置和公开资料边界，不修改生产运行时。

## 2026-11-13 版本与 GitHub Releases 约束

新增 [ADR-0006](../adr/0006-version-authority-and-github-releases.md)、项目技能与版本/发布脚本。`package.json.version` 是唯一版本来源，其他项目版本字段为投影；运行时和测试不再维护独立版本常量。

发布前已执行：4 项隔离文件/Git 测试通过，覆盖升级后投影与命名、版本漂移拒绝、过期/篡改产物拒绝、错误本地/远端 Tag 目标以及被 Git 跟踪的产物/私有文件拒绝；技能格式校验通过；版本检查、typecheck/build、打包与三份资产校验通过。本地 `release/.gitignore` 在打包后仍为 `*`，产物不再被 Git 跟踪。

正式发布由 `npm run release:publish` 执行完整测试、准确源提交/Tag、draft 上传及下载校验，通过后才公开。实际发布状态、资产与摘要以 [GitHub Releases](https://github.com/nblog/qwen-weknora/releases) 和发布脚本核验输出为准；历史验收结果不因此改写。

同日正式执行结果：

- 完整构建与测试退出 0：39 tests / 39 pass / 0 fail / 0 skipped，包含首个客户端安装闭环及版本发布约束；draft 识别修正与冻结源提交的恢复分支另行通过 4 项定向回归。
- [v0.1.0](https://github.com/nblog/qwen-weknora/releases/tag/v0.1.0) 已公开为非 prerelease 的 Latest Release，源 Tag 保持指向 `584371749c0219c0798a9568fa89678e0bc9533a`。发布控制脚本修复未改变运行时或随包输入，按冻结源提交的恢复规则继续，未移动 Tag、重建或覆盖已上传资产。
- ZIP、manifest、SHA-256 三份资产均在 draft 阶段重新下载并逐一核验；ZIP SHA-256 为 `f98d5d1b8693080cd504b30cb84a817f57cddb24f9079bdc7b2ff26f77ad28f0`。
- 匿名访问 Latest 页面和 ZIP 均为 HTTP 200；当前远端 `release/` 与 `.codex-tracking/` 均为 HTTP 404。本地 `release/.gitignore` 保持 `*`，Git 跟踪的这两类目录文件均为 0。
- 技能格式、自动调用元数据及 162 个公共/技能本地链接已校验，根 AGENTS 的触发入口指向项目技能；版本与资产名均从 package.json 派生。

## 文档基线阶段已执行的检查（2026-11-12）

以下仅覆盖**文档与机器可读契约本身**，不是插件运行验收：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `docs/` 与根 README 本地链接可解析 | 通过 | PowerShell 链接检查脚本扫描 README.md、docs/**/*.md 与本轮修改的 4 个 `.codex-tracking` Markdown：156 个本地链接（含文件内锚点）全部可解析。 |
| `schemas/config.schema.json` 自身合法（Draft 2020-12 meta-schema） | 通过 | `uvx check-jsonschema --schemafile https://json-schema.org/draft/2020-12/schema schemas/config.schema.json` 退出码 0。 |
| `examples/config.example.json` 通过 schema 校验；"至少一个工具"与 URL/类型拒绝路径有效 | 通过 | `uvx check-jsonschema --schemafile schemas/config.schema.json examples/config.example.json` 退出码 0；临时样例验证：四工具全关退出 1、部分关闭退出 0、非法 URL/类型退出 1。 |
| 正式文档/schema/示例生产标识客户端中立审查 | 通过 | 对 README.md、docs/、schemas/、examples/ 做大小写不敏感 `qwen` 扫描：schema/示例零命中；文档命中均为真实来源、兼容说明或验收引用语境，无生产标识/运行时假设。 |
| 需求到验收项映射完整 | 通过 | 见下节 |

## 2026-11-12 契约一致性修正复核

针对协调者复核意见的四项修正（配置流水线与 schema 一致性、示例 `$schema` 路径、`ask` 保守破坏性注解、客户端兼容表验证状态）追加的验证；不覆盖上节历史记录：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 修正后 `schemas/config.schema.json` 仍通过 Draft 2020-12 meta-schema | 通过 | `uvx check-jsonschema --schemafile https://json-schema.org/draft/2020-12/schema schemas/config.schema.json` 退出码 0。 |
| 修正 `$schema` 路径后的示例通过 schema 校验 | 通过 | `uvx check-jsonschema --schemafile schemas/config.schema.json examples/config.example.json` 退出码 0。 |
| 窄预处理接受样例：原始 `{"baseUrl":"https://kb.example.test/","apiKey":""}` 预处理后为 `{"baseUrl":"https://kb.example.test/api/v1"}` | 通过 | 对预处理形态执行 `uvx check-jsonschema --schemafile schemas/config.schema.json` 退出码 0（空可选字符串已被窄预处理移除）。 |
| 数值严格性拒绝样例（D-06）：`maxResults` 分别为 `8.5`、`0`、`-1`、`"8"` | 通过 | 四个样例校验均退出码 1，错误分别为 `8.5 is not of type 'integer'`、`0 is less than the minimum of 1`、`-1 is less than the minimum of 1`、`'8' is not of type 'integer'`。 |
| 数值严格性接受样例：`maxResults: 8` | 通过 | 校验退出码 0。 |
| `ask` 注解契约更新：`readOnlyHint=false`、`destructiveHint=true`（保守）、`idempotentHint=false`、`openWorldHint=true`，并说明其描述后端 Agent 潜在效果 | 通过 | [运行架构](../notes/architecture.md#mcp-注解与副作用) 与本清单 C9 人工审查一致。 |
| 客户端兼容表改为"研究源行为（仅 `mcp.ts` 与发布 `0.27.2` 交叉核对）；发布集成待 e2e" | 通过 | [客户端兼容说明](../notes/client-compatibility.md) 人工审查；版本与链接保持原值。 |

## 需求到验收项映射

| 需求/决策 | 验收项 |
| --- | --- |
| [ADR-0001](../adr/0001-portable-plugin-stdio-skill.md) 包结构与组件 | A1、A2、C2、C3、D1 |
| [ADR-0002](../adr/0002-typescript-node22-prebuilt.md) 预构建分发 | A2、A3、C3 |
| [ADR-0003](../adr/0003-config-authority-and-schema.md) 配置权威 | A4、B1～B6 |
| [ADR-0004](../adr/0004-tool-contract-authority.md) fixture 复用 | C1、C2 |
| [工具契约](../notes/tools.md)：范围/缓存/降级 | C6、B5 |
| [工具契约](../notes/tools.md)：分页/截断 | C7 |
| [工具契约](../notes/tools.md)：资源模式 | C8 |
| [工具契约](../notes/tools.md)：ask 语义 | C9、D4 |
| [运行架构](../notes/architecture.md)：流纪律/取消/错误 | C4 |
| [运行架构](../notes/architecture.md)：注解与副作用 | C9、D4 |
| [客户端兼容](../notes/client-compatibility.md) | D1～D5 |
| [上游差异台账](../notes/upstream-sync.md#有意差异台账) D-01/D-02 | C1、C5 |
| [v1 范围](../notes/v1-scope.md)：命名中立 | A5 |
| [v1 范围](../notes/v1-scope.md)：许可 | A6 |
