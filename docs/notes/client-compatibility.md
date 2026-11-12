# 首个客户端兼容说明：Qwen Code 0.27.2

状态：当前有效｜基线日期：2026-11-12｜e2e 复验日期：2026-11-12｜范围：**仅描述验证目标客户端**；本文不是通用运行时规范。

## 固定验证目标

| 项 | 值 |
| --- | --- |
| 客户端 | Qwen Code（npm 包 `@qwen-code/qwen-code`） |
| 版本 | `0.27.2`（gitHead `f42fe0f3251172c1174d00382ece522eafb3c6c2`） |
| Node.js 要求 | >=22.0.0 |
| 依据 | [固定发布包元信息](https://registry.npmjs.org/@qwen-code/qwen-code/0.27.2)与[上游同步基线](upstream-sync.md)；仅核对该发布 commit 的便携 MCP 加载器与研究主线字节一致，不声明整个 CLI 与主线一致 |

不承诺更早 Qwen 版本、其他客户端或 npm/Git 安装路径已经实测。其他 Agent Plugins 1.0.0 客户端为"目标兼容、未验证"。

## 安装方式（客户端专属命令）

```powershell
qwen extensions link <本地插件目录>      # 阶段 2 已验证
qwen extensions install <本地归档>       # 阶段 3 已验证最终产物
```

安装/link 后必须真实验证：插件被发现、stdio 服务启动、工具列表出现、四工具可调用。安装成功消息不是运行验证。

## 该客户端的行为边界（研究源行为，发布集成已复验）

下表事实来自固定**研究主快照** `cbb06f945a9b8fdb584dc8ef2115595d0077d82b` 的源码与文档阅读；其中便携 MCP 加载器 `mcp.ts` 与 npm 发布 `0.27.2`（gitHead `f42fe0f3251172c1174d00382ece522eafb3c6c2`）已交叉核对。阶段 3 已用该发布包真实安装最终归档并完成模型→MCP→REST 闭环。

| 行为 | 研究源行为（研究主快照；仅 `mcp.ts` 与发布 `0.27.2` 交叉核对） | 对本插件的意义 |
| --- | --- | --- |
| 组件类型 | 只激活便携 Skills 与 MCP；不生成 `qwen-extension.json` | 不提供客户端专属 manifest/settings/hooks。 |
| 变量展开 | stdio `args`/`env` 值/`cwd` 单次展开 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}`；`command` 不展开 | `--config ${PLUGIN_DATA}/config.json` 放 `args`。 |
| 环境继承 | 继承普通宿主环境并移除内部秘密 | 仅便利行为；插件不定义环境契约。 |
| 工具命名空间 | MCP 工具呈现为 `mcp__<server>__<tool>` | Skill 用实际发现的工具名，不假设 `tools.weknora_*` 直调 API。 |
| 结构化结果 | 保留 MCP 结构化结果 | `structuredContent` 与正文并存策略可用。 |
| 远程 `Authorization` header | 被客户端过滤 | 本插件为 stdio，不受影响；也说明不能以远程 header 作为便携认证方案。 |
| npm 安装实现 | 只下载并解压包内容 | 必须交付预构建产物；不假设 install/build 被执行。 |
| 重试行为 | 结合信任状态与 `readOnlyHint`/`idempotentHint` 可能自动重放 | `ask` 注解必须如实非只读/非幂等（见[运行架构](architecture.md#mcp-注解与副作用)）。 |

来源：[Qwen 官方说明](https://github.com/QwenLM/qwen-code/blob/cbb06f945a9b8fdb584dc8ef2115595d0077d82b/docs/users/extension/agent-plugins.md)与该 commit 的插件加载器；固定版本与范围见[上游同步基线](upstream-sync.md)。

### 阶段 3 实测补充

| 边界 | 实测结果 |
| --- | --- |
| 安装与发现 | 隔离 home 下 `extensions install <最终 zip>` 成功；`--list-extensions` 显示插件、`weknora` Skill 与 MCP，`mcp list` 显示 stdio 服务 Connected。 |
| 延迟工具发现 | 发布客户端把 MCP 工具放入 deferred-tools；模型先调用客户端 `tool_search`，再用 `tool_call` 调用实际 `mcp__weknora__weknora_*` 名称。生产 Skill 不写死客户端内部命名。 |
| 结构化结果 | 模型上下文收到插件的 MCP 工具结果；测试从该结果提取文档 ID、分页内容和 session ID，而非预写最终答案。 |
| 真实闭环 | 覆盖 search、read_document page 1→2、ask 新会话与同 session 追问；REST mock 断言对应请求。详见 本地私有记录（不随仓库发布）。 |

## e2e 用户配置隔离

阶段 3 测试在隔离环境中运行，避免污染真实用户配置：

1. 每次客户端启动显式覆盖 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`QWEN_CODE_HOME`，并使用 `.tmp-qwen` 下的独立 cwd。
2. 安装器生成的扩展目录与 `PLUGIN_DATA` 均位于隔离 `.qwen` 根；测试遍历生成文件并断言未越出隔离 home，结束后移除沙盒。
3. 确定性 OpenAI-compatible 模型服务执行真实工具调用序列；WeKnora mock 继续直接使用固定上游快照 fixture 语义。
4. 闭环断言覆盖客户端输出、模型请求上下文、MCP 工具结果和 mock REST 请求四层证据；入口为 `test/client-e2e/00-qwen-install-e2e.test.mjs`。
5. 与真实模型/真实部署的区别已显式记录：确定性模型不评估模型能力或答案质量；mock WeKnora 不证明真实部署兼容。

尚无真实部署目标时，本地 mock e2e 通过即可完成 v1 本地验收；真实部署验证单列为未执行项，不作为阻断条件。
