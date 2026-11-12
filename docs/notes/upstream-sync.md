# 上游同步基线与差异台账

状态：当前有效｜基线日期：2026-11-12｜本页维护公开的来源锚点与同步边界；私有研究目录不随仓库发布。

## 固定研究锚点

| 来源 | 固定 commit | 角色 |
| --- | --- | --- |
| [Tencent/WeKnora](https://github.com/Tencent/WeKnora/tree/cbdcebabf48c5ee2d6868b370326aa8341703f62/packages/dsh-weknora) | `cbdcebabf48c5ee2d6868b370326aa8341703f62`（2026-11-09） | REST/SSE 契约与 `packages/dsh-weknora` 参考实现。 |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code/tree/cbb06f945a9b8fdb584dc8ef2115595d0077d82b/packages/core/src/extension/agent-plugins-v1) | `cbb06f945a9b8fdb584dc8ef2115595d0077d82b`（2026-11-12） | 首个客户端加载器与文档；发布交叉锚点 npm `0.27.2`。 |
| [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec/blob/44a0ff84bfdfebccfc649dce9aea9ccc45cbfbf9/spec/1.0.0.md) | `44a0ff84bfdfebccfc649dce9aea9ccc45cbfbf9`（2026-11-06） | Agent Plugins 1.0.0 规范与官方 schema（1.1.0 仅保留为草案记录，不升级）。 |

测试所需的最小公开契约、原始 SHA-256 与许可证见 [`test/_shared/upstream/`](../../test/_shared/upstream/README.md)。契约原文不作本地编辑；历史验证事实不覆盖。公开与私有资料的边界见 [ADR-0005](../adr/0005-private-research-and-public-contracts.md)。

## 状态

阶段 2 已按固定锚点完成生产实现、构建、自动化验证、便携包验证与首个客户端隔离 link 最小证明；阶段 3 已在独立安装产物上完成 stdio 与固定客户端 e2e 复验。公开结果见 [v1 验收清单](../checklist/v1-acceptance.md)。私有研究资料仅作本地辅助，不是构建或测试输入。发现上游更新时先获取候选并分类（采用 / 不适用 / 有意差异 / 需决策），不得直接覆盖锚点。

## 真实本地映射

阶段 2 已建立以下实际文件，并在 SYNC 记录中引用：

| 上游（WeKnora commit `cbdceba`） | 本项目实际路径 | 采用策略 |
| --- | --- | --- |
| `packages/dsh-weknora/src/client.ts` | `src/client.ts` | 已移植 REST/SSE/超时/取消/资源降级逻辑，保留 Tencent MIT 来源与版权通知。 |
| `packages/dsh-weknora/src/config.ts` | `src/config.ts` + `schemas/config.schema.json` | 已保留字段语义与默认值；去除 Cordis/`toolPrefix`，改为文件加载与 schema 单源。 |
| `packages/dsh-weknora/src/tools.ts` | `src/tools.ts` | 已保留四工具业务语义；在 MCP 注册处单一定义 Zod schema，适配注解/错误；会话前缀改为 `weknora:`。 |
| `packages/dsh-weknora/src/render.ts` | 并入 `src/tools.ts` 的正文渲染 | 已保留截断/分数/范围显示规则。 |
| `packages/dsh-weknora/src/index.ts`、`src/harness.ts` | `src/server.ts`、`src/index.ts` | 已仅参考生命周期与工具定义形态；Cordis 注册层不移植。 |
| `packages/dsh-weknora/test/fixtures/api-contract.json` | `test/_shared/upstream/weknora/api-contract.json` | 一个有效的公开 fixture，测试直接引用；来源与原始校验和随文件维护。 |
| `packages/dsh-weknora/test/helpers/mock-weknora.mjs` 等 | `test/_shared/mock-weknora.mjs` 与各能力组测试 | 参考 mock 语义，按本项目测试组织重写；因真实跨组复用提取 `_shared`。 |
| Qwen `agent-plugins-v1/*` | 仅兼容性与 e2e 参考 | 不进入通用运行时假设。 |
| Agent Plugins 官方 schema | 打包测试校验 `plugin.json`/`mcp.json` | 固定 1.0.0，不擅自升级。 |

## 有意差异台账

| ID | 差异 | 上游 | 本项目 v1 | 原因 | 兼容影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | 会话标题前缀 | `dsh: <query>` | `weknora: <query>` | 客户端中立命名澄清。 | 仅影响服务端会话标题展示与精确契约断言；不影响 API 兼容。 | 已实现并验证（阶段 2）。 |
| D-02 | 工具名前缀配置 | `toolPrefix` 可配置，默认 `weknora` | 移除配置项，固定 `weknora_*` | v1 单部署；避免多实例命名框架。 | 配置含 `toolPrefix` 被 schema 拒绝；工具名不变。 | 已实现并验证（阶段 2）。 |
| D-03 | 配置来源 | Cordis patch 行（YAML/`!!js process.env`） | `${PLUGIN_DATA}/config.json` + JSON Schema | Agent Plugins 便携边界；支持本机凭据。 | 上游配置键除 `toolPrefix` 外语义保留。 | 已接受（ADR-0003）。 |
| D-04 | 工具注册层 | dsh `ctx.tools` / harness 结构化定义 | MCP stdio 工具（官方 SDK schema/注解） | 目标生态不同。 | 工具参数与结构化输出字段保持上游语义；注册机制不同。 | 已接受（ADR-0001/0004）。 |
| D-05 | 分发 | npm 包 `@wxg-prc-cpg/dsh-weknora`（dsh bundle） | `weknora-agent-plugin` 预构建归档 | Agent Plugins 分发与客户端不执行构建的现实。 | 上游 npm 入口不适用；预构建文件清单见[范围](v1-scope.md#通用包结构)。 | 已接受（ADR-0002）。 |
| D-06 | 数值预算校验 | `positiveInt` 对正小数 `Math.floor` 后接受（零/负/非有限数拒绝） | schema 严格要求 `integer >= 1`：小数、零、负数一律拒绝，不取整 | 窄预处理不做类型转换；配置错误应在启动时以精确 schema 违规暴露，而不是被静默截断（[ADR-0003](../adr/0003-config-authority-and-schema.md)）。 | 上游可写入的 `8.5` 在本项目被拒绝并要求改为整数；零/负数同样拒绝；字符串数字依旧非法。 | 已实现并验证（阶段 2）。 |

新增差异必须先登记本表并给出 ADR/决策来源；实现代码中的差异没有台账与验证证据视为未治理漂移。

## 许可

上游 WeKnora 与 `dsh-weknora` 为 MIT。移植源码时在发布包 `NOTICE` 与源文件保留 Tencent 原版权与许可声明；公开测试契约目录保留所需原许可证。

## 验证与推进条件

1. 候选更新：在临时 checkout 中比较本页固定 commit 与候选 commit，关注 `packages/dsh-weknora/`、实际依赖的 WeKnora handler/types/router 与客户端插件加载器；记录同步日期、旧/新版本及采用/不适用/有意差异/需决策的分类。
2. 采用：更新本项目实现、文档及公开契约 → 运行相关回归（契约/客户端/打包）→ 记录实际结果 → 才更新本页锚点与公开契约的来源/校验和。私有调查记录不得作为公开测试的必需输入。
3. 规范升级（如 1.1.0 转正）：需确认首个客户端支持的 canonical schema 后作为新决策，不由文档/实现 worker 擅自升级。
4. 未执行验证（真实部署、真实模型、Go 契约测试等）如实记录于验收清单，不填"通过"。
