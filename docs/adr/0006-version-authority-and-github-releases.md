# ADR-0006：package.json 版本权威与 GitHub Releases

- 状态：已接受
- 日期：2026-11-13
- 决策主体：用户要求产物不进入 Git、迁移到 GitHub Releases，并通过项目技能及脚本收束版本与发布流程。

## 决策

1. 项目版本唯一权威为 npm 原生 `package.json.version`，采用 SemVer。`plugin.json.version` 和 lockfile 项目版本仅是生成投影，脚本统一更新、校验；运行时和测试从同一来源读取。
2. Tag、release 分支和资产命名从包版本派生，不在命令中提供独立覆盖值。已有 Tag 指向其他提交、已有同版本 Release、脏工作区或版本投影不一致时停止，不静默覆盖。
3. `release/` 为本地忽略目录，内部 `.gitignore` 写 `*`，根忽略规则提供 clone 后的保护。构建保留该忽略文件，不将产物提交到 Git。GitHub Releases 承载 ZIP、逐文件 manifest 与 SHA-256 文件。
4. 项目技能 `release-version` 自动匹配版本发布/升级、新 Release、release 分支及 Tag 需求。`AGENTS.md` 指向技能；技能调用确定性脚本，不依赖模型手工拼接版本与发布命令。
5. 正式发布只从干净的 `main` 或当前版本的 release 分支进行；构建并完整测试后，推送准确的源提交和 Tag，先上传 draft 资产、下载校验，再公开。失败不自动覆盖、移动 Tag 或重复创建。
6. 开分支、版本升级和本地打 Tag 不自动授权外部发布。用户已请求发布的流程自主完成，不增加重复确认。
7. 2026-11-13 首次实际执行发现按 Tag 的 REST 接口对 draft 返回 404；改用分页列表识别 draft。完整资产的受控恢复冻结原 Tag/源提交，只允许非分发输入的修复，并重新下载核验；不覆盖资产或已公开版本。

## 背景与后果

此前产物被跟踪在 `release/`，测试和服务端还有独立项目版本常量。这会让版本升级、源码与发布包发生漂移。此决策替代 [ADR-0002](0002-typescript-node22-prebuilt.md) 中未限定的产物存放/版本工作流，保留其预构建、Node.js 与便携分发选择。

克隆源码后先构建再运行安装产物测试；下载用户从 GitHub Releases 获取预构建 ZIP。技能与测试属于维护工具，不进入插件发布包。历史验收中的旧产物与版本是当时事实，不批量替换历史记录或第三方协议/客户端版本。

## 权威入口

- [项目技能与命令](../../.agents/skills/release-version/SKILL.md)
- [版本与发布说明](../notes/release-version.md)
- [验收清单](../checklist/v1-acceptance.md)
