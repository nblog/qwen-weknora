# WeKnora Agent Plugin

[English](README.md) | 简体中文

基于 [Agent Plugins](https://agent-plugins.org/specification) 的 [WeKnora](https://github.com/Tencent/WeKnora) 集成。

- 检索知识库中的相关内容。
- 分页阅读文档。
- 调用 WeKnora 问答，并在同一会话中继续追问。

## 使用

需要 Node.js 22+、可访问的 WeKnora 实例，以及支持 Agent Plugins 的 AI 客户端。

1. 下载[插件 ZIP](https://github.com/nblog/qwen-weknora/raw/refs/heads/main/release/weknora-agent-plugin-0.1.0.zip)。
2. 使用客户端的插件安装功能安装。例如，在 Qwen Code 中：

   ```sh
   qwen extensions install ./weknora-agent-plugin-0.1.0.zip
   ```

3. 在客户端分配的插件数据目录（`PLUGIN_DATA`）中创建 `config.json`：

   ```json
   {
     "baseUrl": "http://localhost:8080",
     "apiKey": "your-weknora-api-key"
   }
   ```

   将地址和 API Key 替换为你的部署信息。更多选项见[配置模板](examples/config.example.json)。
4. 重启客户端，然后让它检索或阅读知识库：

   > 在我的知识库中查找部署指南。

---

上游参考：[dsh-weknora](https://github.com/Tencent/WeKnora/tree/main/packages/dsh-weknora)
