# ADR-0001：采用 Agent Plugins 1.0.0 + 单 stdio MCP 服务 + 单 Skill

- 状态：已接受
- 日期：2026-11-12
- 决策主体：用户授权按推荐基线推进（见 [v1 范围](../notes/v1-scope.md)）

## 背景

上游 `dsh-weknora` 通过 DeepSeek Harness 的 Cordis 配置层注册工具，无法被其他 AI 编码客户端复用。目标是做一个面向开放生态的 WeKnora 插件：知识检索、阅读与服务端问答仍由 WeKnora 提供，插件只做工具契约与使用策略适配。首个验证客户端是 Qwen Code 0.27.2，但产品必须客户端中立。

固定依据：Agent Plugins 1.0.0 规范与官方 schema（`agentplugins/agent-plugins-spec` commit `44a0ff84bfdfebccfc649dce9aea9ccc45cbfbf9`）、Qwen 加载器（`cbb06f945a9b8fdb584dc8ef2115595d0077d82b`）。锚点与快照见 [上游同步基线](../notes/upstream-sync.md)。

## 决策

1. 插件包采用 Agent Plugins **1.0.0**（不使用 1.1.0 草案）：根 `plugin.json` + 根 `mcp.json`，两者 `$schema` 版本一致。
2. 只提供 **一个本地 stdio MCP 服务**：服务进程调用 WeKnora REST `/api/v1`，不暴露远程 MCP 条目。
3. 只提供 **一个标准 `weknora` Skill**（`skills/weknora/SKILL.md`），描述何时检索、如何分页续读、何时委托问答；Skill 不是权限边界，也不预授权任何客户端工具。
4. 不使用任何客户端专属 manifest、settings、hook、command、agent 或 workflow；不通过 `extensions` 命名空间携带运行时语义。
5. 工具固定为四个：`weknora_list_knowledge_bases`、`weknora_search`、`weknora_read_document`、`weknora_ask`；工具开关默认全开。`ask` 保留 `session_id` 续聊、可选 `agent_id` 与 `web_search`（默认 `false`），并如实描述副作用（见 [运行架构](../notes/architecture.md#mcp-注解与副作用)）。

## 备选方案与取舍

| 备选 | 放弃原因 |
| --- | --- |
| 纯 Skill + 脚本直连 REST | 少一层协议，但没有标准工具契约、参数校验、取消/超时与结构化结果；各客户端无法统一发现。 |
| 特定客户端原生扩展 | 可用专属设置/UI，但绑定单客户端，违背客户端中立目标；Agent Plugins 优先级也会遮蔽它。 |
| WeKnora 原生远程 MCP（`/mcp/:endpoint_id` 或 Python `mcp-server`） | 工具面、鉴权与语义和 REST 基线不同（端点白名单、Agent 由端点决定、Python 运行时）；形成双后端框架，超出 v1。 |
| 多 MCP 服务/多部署实例 | v1 明确单部署；多实例需定义多配置文件、命名与数据目录组织，属于未确认需求。 |

## 后果与约束

- 正面：包格式、发现规则、`PLUGIN_ROOT`/`PLUGIN_DATA` 语义由规范定义；stdio 是客户端支持面最广的 MCP 传输；Skill 可承载使用策略而不侵入工具实现。
- 代价：`ask` 的流式回答必须在服务进程内消费 WeKnora SSE(Server-Sent Events) 再聚合为单个 MCP 结果；无法利用客户端专属设置界面。
- 后续实现必须遵守：`mcp.json` 只含一个 stdio 条目，`command` 是单个可执行 token（`node`），JS 入口与配置路径放在 `args`；除 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` 外不做任何变量展开。
- 兼容承诺边界：只有实际验证过的客户端（v1 为 Qwen Code 0.27.2）可声明"已验证"；其他 Agent Plugins 1.0.0 客户端只能说"目标兼容、未实测"。
- 历史调研中 WeKnora 原生 MCP 与 Python 服务保留为研究资料；若未来支持，须作为新 ADR 处理认证与语义边界。

## 关联

- [ADR-0002 技术栈与分发](0002-typescript-node22-prebuilt.md)
- [工具契约](../notes/tools.md)、[运行架构](../notes/architecture.md)
- [上游同步基线与差异台账](../notes/upstream-sync.md)
