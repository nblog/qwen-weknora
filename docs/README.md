# 文档总纲

本文件是 `docs/` 的统一导航入口。`docs/` 正式文档使用简体中文；根 [README.md](../README.md) 默认英文，并提供[简体中文版](../README_zh-CN.md)。JSON Schema 与示例中的描述性文字使用英文代码注释风格。文档职责划分遵循根 [AGENTS.md](../AGENTS.md)。

## 阅读顺序

新加入的实现/测试 worker 建议按以下顺序阅读：

1. [v1 范围与生产契约](notes/v1-scope.md)：v1 做什么、不做什么、生产命名与包结构。
2. [ADR-0001 便携插件 + stdio MCP + Skill](adr/0001-portable-plugin-stdio-skill.md)、[ADR-0002 TypeScript 与预构建分发](adr/0002-typescript-node22-prebuilt.md)：接入结构与技术栈决策。
3. [ADR-0003 配置权威与 schema](adr/0003-config-authority-and-schema.md)、[ADR-0004 工具契约权威](adr/0004-tool-contract-authority.md)、[ADR-0005 私有研究与公开契约](adr/0005-private-research-and-public-contracts.md)：契约权威、防漂移与公开边界。
4. [运行架构](notes/architecture.md)、[工具契约](notes/tools.md)、[配置契约](notes/configuration.md)：实现必须遵守的稳定约束。
5. [首个客户端兼容说明](notes/client-compatibility.md)：验证目标客户端的专属边界，不是通用规范。
6. [上游同步基线与差异台账](notes/upstream-sync.md)：固定上游 commit、真实映射与有意差异。
7. [v1 交付计划](notes/v1-delivery-plan.md) 与 [v1 验收清单](checklist/v1-acceptance.md)：实现与 e2e 阶段入口。

## 文档索引

### 决策记录（ADR）

| 文档 | 用途 |
| --- | --- |
| [ADR-0001 便携插件 + 单 stdio MCP + 单 Skill](adr/0001-portable-plugin-stdio-skill.md) | 采用 Agent Plugins 1.0.0 包格式与本地 stdio MCP 架构的背景、备选与后果。 |
| [ADR-0002 TypeScript、Node.js >=22 与预构建分发](adr/0002-typescript-node22-prebuilt.md) | 技术栈、运行时要求与"交付可直接运行的预构建包"的分发决策。 |
| [ADR-0003 配置权威与 JSON Schema 契约](adr/0003-config-authority-and-schema.md) | `--config` 文件权威、schema 单源、校验与防漂移策略。 |
| [ADR-0004 工具契约权威与 fixture 复用](adr/0004-tool-contract-authority.md) | 工具请求/结果 schema 的权威定义、REST fixture 复用与校验策略。 |
| [ADR-0005 私有研究目录与公开测试契约](adr/0005-private-research-and-public-contracts.md) | 私有资料不入 Git；测试所需公开契约、许可证及首提交重建边界。 |

### 当前有效说明（notes）

| 文档 | 用途 |
| --- | --- |
| [v1 范围与生产契约](notes/v1-scope.md) | 正式 v1 目标、非目标、生产命名、通用包结构、兼容承诺。 |
| [运行架构](notes/architecture.md) | 架构总览、模块边界、生命周期、stdout/stderr、取消/超时、错误映射、MCP 注解。 |
| [工具契约](notes/tools.md) | 四工具的参数与结构化输出、REST 映射、范围、缓存、分页、截断与引用。 |
| [配置契约](notes/configuration.md) | 配置文件行为、缺失/无效配置处理、目录约束、凭据边界与示例说明。 |
| [安装、配置与使用](notes/usage.md) | 生产包运行要求、配置步骤、四工具使用策略与维护构建命令。 |
| [首个客户端兼容说明](notes/client-compatibility.md) | Qwen Code 0.27.2 验证目标的客户端专属行为与隔离验证方式。 |
| [上游同步基线与差异台账](notes/upstream-sync.md) | 固定上游版本、真实本地映射预定、有意差异、SYNC 状态与推进条件。 |
| [v1 交付计划](notes/v1-delivery-plan.md) | 分阶段实现计划、测试组织、e2e 门槛与需求到验收的映射。 |

### 验收（checklist）

| 文档 | 用途 |
| --- | --- |
| [v1 验收清单](checklist/v1-acceptance.md) | A～D 本地必选验收与 E 真实部署验收的执行结果、日期与最小证据。 |

### 结项记录（implemented）

| 文档 | 用途 |
| --- | --- |
| [2026-11-12 v1 文档基线结项](notes/implemented/2026-11-12-v1-docs-baseline.md) | 本阶段落地范围、结果与后续事项。 |
| [2026-11-12 v1 本地交付结项](notes/implemented/2026-11-12-v1-local-delivery.md) | v1 实现、独立 e2e、最终归档与 README 收尾的完成结果。 |

### 机器可读契约与示例

| 文件 | 用途 |
| --- | --- |
| [`schemas/config.schema.json`](../schemas/config.schema.json) | 用户配置文件的权威 JSON Schema（Draft 2020-12）。 |
| [`examples/config.example.json`](../examples/config.example.json) | 不含真实秘密的配置示例，供复制到 `PLUGIN_DATA/config.json` 后修改。 |

## 维护约定

- 正式约束只在一处定义，其他文档引用原定义；发现冲突时先修权威文档，再同步引用。
- ADR 保留决策脉络；被替代时新增 ADR 并回标旧 ADR，不覆盖历史。
- 验收清单执行后记录 ISO 8601 日期、实际结果与最小证据；未执行项不得标记通过。
- 研究过程与私有执行证据仅保留在本机，不提交到公开仓库；公开测试契约和许可证见 [`test/_shared/upstream/`](../test/_shared/upstream/README.md)。
