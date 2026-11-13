# ADR-0002：TypeScript、Node.js >=22 与预构建 JavaScript 分发

- 状态：已接受；产物存放与版本发布策略由 [ADR-0006](0006-version-authority-and-github-releases.md) 补充，其余技术栈与预构建决策继续有效
- 日期：2026-11-12
- 决策主体：用户授权按推荐基线推进（见 [v1 范围](../notes/v1-scope.md)）

## 背景

上游 `dsh-weknora` 的 REST 客户端、SSE 解析与工具语义已是 TypeScript，并配套 58 项 mock 测试。首个验证客户端 Qwen Code 0.27.2 要求 Node.js >=22。同时，Agent Plugins 客户端（含 Qwen 的 npm 安装实现）只下载/解压包内容，不承诺替插件执行 `npm install`、`prepare` 或构建。

## 决策

1. 实现语言为 **TypeScript**，编译为 JavaScript 交付；使用官方 MCP TypeScript SDK 提供 stdio 服务。
2. 运行时要求 **Node.js >=22**；不引入第二套运行时（无 Python/Go 服务进程）。
3. 交付 **预构建包**：归档内含全部运行所需文件（`dist/`、manifest、Skill、schema、许可证与版权通知），安装侧无需依赖安装或编译。
4. 分发验证顺序：先在本地以目录 link 验证，再验证归档/安装产物；npm 分发可与包名 `weknora-agent-plugin` 对齐，但在实际验证前不承诺。
5. `mcp.json` 的 stdio 条目使用 `command: "node"`，入口脚本与 `--config` 参数放在 `args` 中，不依赖 shell 包装。

## 备选方案与取舍

| 备选 | 放弃原因 |
| --- | --- |
| Python 重写 | 符合用户常用工具链，但需要重写 REST/SSE 客户端与测试，引入第二运行时，失去上游参考实现优势。 |
| Go/Rust 二进制 | 分发简单，但与上游 TypeScript 参考完全脱节，开发与 SYNC 成本更高。 |
| 源码 TypeScript 直接分发（依赖客户端 install/build） | 违反 Agent Plugins 客户端行为现实；任何客户端不执行构建都会安装失败。 |

## 后果与约束

- 正面：最大化复用上游已验证的 REST/SSE 逻辑与契约 fixture；类型系统支撑工具 schema 的一致性；Node 22 原生 `fetch`、`AbortSignal.any`、流读取满足需求。
- 代价：必须维护编译/打包步骤，并在测试中验证"归档内预构建文件可直接运行"；开发依赖（TypeScript、类型、SDK、测试器）只用于构建，不进入运行时假设。
- 移植上游代码时必须保留 Tencent MIT 许可与版权通知（见 [上游同步基线](../notes/upstream-sync.md#许可)）。
- 构建产物不得包含用户配置、凭据或 `.codex-tracking/` 研究快照。
- 版本策略：插件 `version` 采用语义化版本建议；具体发布版本号由实现阶段按仓库工作流决定。

## 关联

- [ADR-0001 接入结构](0001-portable-plugin-stdio-skill.md)
- [v1 范围与生产契约](../notes/v1-scope.md)、[首个客户端兼容说明](../notes/client-compatibility.md)
