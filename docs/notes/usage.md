# 安装、配置与使用

状态：当前有效｜更新日期：2026-11-13｜项目版本以 [package.json](../../package.json) 的 `version` 为准

## 运行要求

- Node.js `>=22`；插件以 `node` 启动本地 stdio MCP(Model Context Protocol) 服务。
- 一个可访问的 WeKnora REST `/api/v1` 部署。上游声明测试版本为 0.8.0；真实部署兼容性需按验收清单单独验证。
- 支持 Agent Plugins 1.0.0 的客户端。客户端会加载根 `plugin.json`、`mcp.json` 和 `skills/weknora/SKILL.md`。

## 安装

发布归档是自包含的：解压或安装后不需要执行 `npm install`、构建或下载依赖。归档内包含 `dist/server.js`、配置 schema、示例、Skill、许可证与版权通知。

按所用客户端的 Agent Plugins 安装方式选择：

1. 从本地插件目录安装或 link，用于开发验证；
2. 从 [GitHub Releases](https://github.com/nblog/qwen-weknora/releases/latest) 下载版本对应的 ZIP 并安装。仓库文件树不再存放发布产物。

不要把归档解压到需要运行时写入的目录；插件包根目录视为只读 `PLUGIN_ROOT`。

## 配置

1. 确认客户端为插件创建或指定的 `PLUGIN_DATA` 目录。
2. 复制包内 `examples/config.example.json` 为 `${PLUGIN_DATA}/config.json`。
3. 修改 `baseUrl`、凭据与预算字段。字段权威约束见 [`schemas/config.schema.json`](../../schemas/config.schema.json) 与[配置契约](configuration.md)。
4. 启动前检查该文件权限。`apiKey` 与 `tenantId` 是明文本机凭据；不要提交、截图或把 `config.json` 放入发布包。

最小配置示例：

```json
{
  "baseUrl": "https://weknora.example.test",
  "apiKey": "replace-with-your-deployment-api-key"
}
```

配置缺失或无效时，服务进程不会向 stdout 输出内容，会在 stderr 给出违规项并以非零码退出。示例中的 `$schema` 只是编辑器提示；运行时不会联网读取。

## 使用

客户端工具列表中应出现四个工具：

| 工具 | 用途 |
| --- | --- |
| `weknora_list_knowledge_bases` | 列出当前凭据可见的知识库。 |
| `weknora_search` | 语义检索片段，并可按标题/文件名补充文档命中。 |
| `weknora_read_document` | 按分块页读取文档正文，带预算与分页标记。 |
| `weknora_ask` | 调用服务端 RAG/自定义 Agent 生成答案，可续聊。 |

`weknora` Skill 会引导模型先检索和阅读，只有综合问题时才调用 `ask`。`ask` 会创建或更新服务端会话，并按后端 Agent 能力保守标注为可能产生副作用；同一会话追问应传回 `session_id`。`web_search` 默认关闭。

## 构建与打包

维护者可在仓库根目录执行：

```powershell
npm ci
npm run package
npm test
```

`npm run package` 校验版本投影，使用显式文件白名单在忽略的本地 `release/` 生成当前包名/版本的 ZIP、SHA-256 文件和逐文件清单，并保留内部 `.gitignore`。`npm test` 会解压/安装该归档，因此全新 clone 后先打包再测试。测试、研究快照、用户配置、`node_modules/` 与构建缓存不进入归档。

版本升级、release 分支、Tag 和正式发布主动使用 [release-version 技能](../../.agents/skills/release-version/SKILL.md)，不手改其他文件中的版本或直接拼接发布名。正式产物上传到 GitHub Releases。
