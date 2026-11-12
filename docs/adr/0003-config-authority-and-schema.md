# ADR-0003：配置权威为 `--config` 文件 + 单一 JSON Schema

- 状态：已接受
- 日期：2026-11-12
- 决策主体：用户授权按推荐基线推进（见 [v1 范围](../notes/v1-scope.md)）

## 背景

上游配置来自 Cordis patch 行（YAML，含 `!!js process.env`），不可移植，也不能包含本机凭据。Agent Plugins 便携配置字段不展开业务环境变量，`env` 值也不是可移植秘密机制。插件需要一个能放真实凭据、跨客户端一致、且不进发布包的配置边界。

## 决策

1. **唯一权威配置入口**：`mcp.json` stdio `args` 固定传 `--config ${PLUGIN_DATA}/config.json`。文件由用户在本机创建（可从 `examples/config.example.json` 复制），不属于发布包。
2. **单一 schema 权威**：[`schemas/config.schema.json`](../../schemas/config.schema.json)（JSON Schema Draft 2020-12）是配置字段、类型、默认值与约束的唯一权威；[配置契约](../notes/configuration.md) 只做解释与行为定义，不再维护第二份字段定义。schema 同时随包分发，供编辑器校验。
3. **校验策略**：服务启动时依次完成 JSON 解析 → 对**已声明字符串字段**的窄预处理（trim、空可选字符串视为未提供、归一化 `baseUrl`）→ schema 校验与默认值应用 → 产出不可变 `ResolvedConfig`。窄预处理不做通用类型转换或宽松修复：数值预算必须本来就是 `integer >= 1`，小数、零、负数在 schema 层拒绝（不向下取整）；这是相对上游"正数向下取整"更严格的有意差异（[D-06](../notes/upstream-sync.md#有意差异台账)）。任一步失败即启动失败（详见[配置契约](../notes/configuration.md#缺失无效与启动行为)），不在首个工具调用时才暴露。
4. **防漂移**：实现阶段的回归测试必须（a）用 schema 校验仓库内示例与代表性合法/非法样例；（b）断言 TypeScript 解析后的 `ResolvedConfig` 字段、默认值与 schema `default`/约束一致；（c）断言非法配置导致非零退出且 stderr 含具体违规项。schema 与代码任一侧变化都必须先改权威文档再同步。
5. **环境变量**：v1 不定义任何 `WEKNORA_*` 环境变量契约。客户端继承/清理宿主环境只是便利行为，不是跨客户端保证；不新增配置向导、系统凭据库或自动探测框架。

## 备选方案与取舍

| 备选 | 放弃原因 |
| --- | --- |
| 便携 `mcp.json` `env` 携带配置 | `env` 是可见包数据，规范禁止嵌秘密；且值只能来自两个插件变量展开，无法表达部署地址。 |
| 远程 MCP headers 认证 | 本插件是本地 stdio；且首个客户端会过滤 `Authorization`，不具便携性。 |
| 系统凭据库（Keychain/DPAPI 等） | 跨平台范围与集成成本高，v1 无此需求；文件权限边界由用户环境负责并如实文档化。 |
| 配置向导/自动探测 | 隐藏部署差异，增加未验证的失败路径；与"最小真实抽象"原则冲突。 |

## 后果与约束

- 配置文件可包含真实凭据（`apiKey` 等），因此**永不进入**发布归档、构建产物、日志或测试快照。
- `knowledgeBaseIds` 是可被调用参数覆盖的检索默认，**不是权限白名单**（见 [工具契约](../notes/tools.md#范围解析)）。
- schema `additionalProperties: false` 保持封闭；新增字段必须先改 schema 与本文，再进入实现。
- 相对上游差异：配置从 Cordis 行改为文件、去除 `toolPrefix`（v1 固定 `weknora_*`）、数值预算严格按 schema 拒绝小数/零/负数，均已登记于[上游差异台账](../notes/upstream-sync.md#有意差异台账)。

## 关联

- [配置契约](../notes/configuration.md)
- [ADR-0004 工具契约权威](0004-tool-contract-authority.md)
