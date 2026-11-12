# ADR-0004：工具请求/结果契约的权威定义与 fixture 复用

- 状态：已接受；fixture 存放与公开边界于 2026-11-12 按 [ADR-0005](0005-private-research-and-public-contracts.md) 更新，其余契约原则继续有效
- 日期：2026-11-12
- 决策主体：用户授权按推荐基线推进（见 [v1 范围](../notes/v1-scope.md)）

## 背景

工具契约存在三层：WeKnora REST 线上协议、插件工具的 MCP 输入/输出、面向模型的说明文案。若各自手抄一份 JSON 定义，会在实现与上游更新时漂移。上游已有受治理的 `test/fixtures/api-contract.json` 精确记录每个 REST 调用与读取的响应字段，并由其 Go/JS 契约测试共同约束。

## 决策

1. **REST 线上协议权威**：上游快照中的 [api-contract.json](../../test/_shared/upstream/weknora/api-contract.json)（WeKnora commit `cbdcebabf48c5ee2d6868b370326aa8341703f62`）是精确请求样本与响应字段的唯一权威。本项目**不复制第二份 fixture**；实现测试直接引用该快照路径。
2. **MCP 输入/输出权威**：工具的 MCP `inputSchema`/`outputSchema` 在服务端工具注册处**定义一次**（代码即源），[工具契约](../notes/tools.md) 是其 v1 规范说明。不预建独立的工具 schema 框架或第二份 schema 文件。
3. **文档职责**：`docs/notes/tools.md` 定义字段语义、REST 映射、范围/缓存/分页/截断/引用行为与有意差异；字段名与 JSON 结构以注册处的 JSON Schema 为准，二者由契约测试锚定一致。
4. **校验策略**：实现阶段的契约测试必须（a）断言 mock REST 服务收到的请求与上游 fixture 一致（含查询参数、body 字段与鉴权头）；（b）断言每个工具的 `inputSchema`/`outputSchema` 与文档声明的 v1 契约一致；（c）覆盖每个工具的成功路径与至少一个失败/取消路径。
5. **JSON Schema 方言**：工具 schema 使用合理标准 JSON Schema（Draft 2020-12 风格），与官方 MCP SDK 输出兼容；不引入自定义校验框架。

## 备选方案与取舍

| 备选 | 放弃原因 |
| --- | --- |
| 复制 fixture 为本地第二份 JSON | 立即产生双源漂移；上游更新时无法判断哪份是权威。 |
| 每个工具一个独立 `schemas/tool-*.schema.json` 文件 | v1 无第二消费者；只会复制注册处定义，增加同步负担。 |
| 仅以 TypeScript 类型为准 | 类型无法表达描述、枚举与 MCP 线上 JSON 结构的全部约束，也不便测试断言。 |

## 后果与约束

- 上游 fixture 更新时，SYNC 流程先对比快照新旧 commit，再决定采用/登记差异（见 [上游同步基线](../notes/upstream-sync.md)），本项目文档与测试同步引用新快照，不手抄内容。
- `structuredContent` 与人类可读 `content` 并存：结构化字段供程序消费，正文由结构化字段渲染，禁止两者各持一份独立事实。
- 会话标题差异（`weknora:` 对上游 `dsh:`）在 fixture 对比中必须按已登记差异处理，不得让测试悄悄漂移。

## 关联

- [工具契约](../notes/tools.md)
- [ADR-0001 接入结构](0001-portable-plugin-stdio-skill.md)、[ADR-0003 配置权威](0003-config-authority-and-schema.md)
