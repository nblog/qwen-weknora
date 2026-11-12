# v1 交付计划

状态：当前有效｜创建日期：2026-11-12｜验收入口：[v1 验收清单](../checklist/v1-acceptance.md)

## 阶段模型

| 阶段 | 位置 | 产出 | 状态 |
| --- | --- | --- | --- |
| 1 文档基线 | `docs/v1`（当前 checkout） | 正式文档、schema、示例、导航与验证 | 已完成（2026-11-12） |
| 2 实现 | `v1-implementation` child worktree（本地分支 `lianping/v1-implementation`） | 生产插件、构建/打包、类型检查、必要测试、便携归档与隔离 link 证明 | 已完成（2026-11-12） |
| 3 e2e | worktree `v1-e2e`（分支 `lianping/v1-e2e`） | 独立 e2e、真实客户端进程闭环、验收记录与最终 README | 已完成（2026-11-12） |

各阶段只提交本地分支；不推送、不发布、不自动合并 `main`。

## 阶段 2：实现里程碑

按依赖顺序推进；每步的可验证标准如下（详细命令与状态见验收清单）：

| # | 里程碑 | 内容 | 可验证标准 |
| --- | --- | --- | --- |
| M1 | 工程骨架 | `package.json`（开发依赖、构建/测试脚本）、TS 配置、目录结构 | `npm run typecheck` 通过；无运行时依赖泄漏进假设。 |
| M2 | 配置层 | `src/config.ts` + schema 加载/归一/校验；CLI 参数解析 | 合法/缺失/非法配置测试通过；非法退出非零且 stdout 为空。 |
| M3 | REST 客户端 | `src/client.ts`：JSON/SSE、鉴权、超时/取消、403 特定降级、错误 envelope | mock 服务契约测试与 fixture 一致；断流/取消/超时路径有回归。 |
| M4 | 工具层 | 四工具 schema、范围解析、预算/分页/截断、结构化结果与正文 | 每工具成功+失败路径测试；结构化字段与本文档一致。 |
| M5 | MCP 服务 | 生命周期、stdout/stderr 纪律、注解、错误映射、关闭 | stdio 初始化/工具发现集成测试；stdout 只含协议帧。 |
| M6 | Skill 与 manifest | `plugin.json`、`mcp.json`、`skills/weknora/SKILL.md` | 官方 1.0.0 schema 校验通过；Skill 策略与工具契约一致。 |
| M7 | 构建与打包 | 编译到 `dist/`、显式清单归档、NOTICE/LICENSE | 归档解压后无 `npm install` 可直接运行；无秘密/研究资料混入。 |

实现阶段必须先读 [docs/README.md](../README.md) 阅读顺序；契约冲突时停止并按仓库规则对齐基线，不得静默改设计。

## 测试组织

遵循根 AGENTS：`test/<capability-group>/` 分组，组内可用 `00_` 前缀表达递进；根目录不放零散测试。

| 分组 | 覆盖 | 关键边界 |
| --- | --- | --- |
| `test/config-contract/` | schema 校验、默认值、归一、启动失败 | 全部工具关闭、非法 URL、缺失文件、stdout 纪律 |
| `test/rest-client/` | REST/SSE 映射、鉴权头、超时/取消、资源降级 | SSE 无 `complete`、403 文案匹配才降级、错误 envelope |
| `test/tool-contract/` | 四工具参数/输出、范围、缓存、分页、截断 | 引用上游 fixture 的请求断言；KB 列表缓存失败重试 |
| `test/mcp-server/` | 初始化、能力协商、工具发现、注解、关闭 | stdout 仅 MCP；`ask` 注解非只读/非幂等 |
| `test/package-contract/` | manifest 校验、归档清单、预构建可运行、客户端中立标识 | 无 qwen 生产标识；无凭据；schema/示例随包 |
| `test/package-e2e/` | 最终归档的独立 stdio 全链路 | 四工具、分页续读、同 session 追问、取消、双超时与断流 |
| `test/client-e2e/` | 首个客户端真实进程闭环（阶段 3） | 隔离配置、确定性模型、mock WeKnora |

测试价值准则：优先覆盖真实跨边界风险（协议映射、取消、预算、降级、打包产物），不写与实现同构的"照镜子"断言；不为未实现的抽象预建框架。

## 阶段 3：e2e 门槛

分两层，均须在 e2e worktree 用**安装产物**（非源码 link 起步；link 已在阶段 2 验证）完成：

1. **stdio 直连层**：以真实子进程完成 MCP `initialize` → 能力协商 → `tools/list` 发现四工具 → 逐个调用四工具（mock WeKnora）→ 取消/超时各一条。
2. **客户端闭环层**：真实首个客户端进程加载安装产物，在隔离用户配置下，由确定性模型服务驱动：用户问题 → 模型选择 `weknora_search` → 插件调用 mock WeKnora REST → 结果回到客户端会话（可断言的最终输出）。再覆盖一次 `read_document` 与一次 `ask` 续聊（传回 `session_id`）。

可复现性：确定性模型服务固定工具选择序列；mock WeKnora 按上游 fixture 响应；测试环境（HOME/配置目录/`PLUGIN_DATA`）全部隔离并可重置。

阶段 3 执行结果：最终归档经独立 stdio 层与固定 Qwen Code `0.27.2` 真实安装闭环验证；`npm run package` 后 `npm test` 为 35/35 通过。生产修复、最终哈希、隔离边界与未执行维度见 [v1 验收清单](../checklist/v1-acceptance.md) 与 本地私有记录（不随仓库发布）。

必须显式区分的验证维度：

| 维度 | v1 e2e 覆盖情况 |
| --- | --- |
| 插件协议与客户端集成 | 覆盖（确定性模型 + mock WeKnora）。 |
| 模型能力/答案质量 | 不覆盖（确定性服务不评估模型）。 |
| 真实 WeKnora 部署兼容 | 不覆盖；无部署目标时单列未执行，不阻断本地 v1。 |

## 需求 → 验收映射

| 需求来源 | 验收组 |
| --- | --- |
| ADR-0001 包结构与组件 | A（包契约）、D（e2e） |
| ADR-0002 预构建分发 | A、C3 |
| ADR-0003 配置权威 | B |
| ADR-0004 工具契约/fixture | C |
| [工具契约](tools.md) 语义 | C、D |
| [运行架构](architecture.md) 纪律 | C4、D |
| [客户端兼容](client-compatibility.md) | A5、D |
| [上游差异](upstream-sync.md#有意差异台账) | C1、C5 |

映射明细见 [v1 验收清单](../checklist/v1-acceptance.md#需求到验收项映射)。
