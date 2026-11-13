---
name: release-version
description: Manage this project's version upgrades, release branches, Git tags, and GitHub Releases. Use when a request mentions publishing or upgrading a version, a new release or release branch, or tagging a release point.
---

# Release version

本技能管理当前仓库的版本和 GitHub Releases。先读根 `AGENTS.md`、`docs/README.md` 与 [发布决策](../../../docs/adr/0006-version-authority-and-github-releases.md)。需要 Node.js 22+、npm、PowerShell 7、Git 和已登录的 `gh`；首次使用先执行 `npm ci` 安装锁定依赖。

## 版本与命令

`package.json.version` 是唯一版本来源。脚本同步 `plugin.json.version`、lockfile 项目版本；Tag 为 `v<version>`，release 分支为 `release/<version>`，资产名由包名和该版本派生。不要手工改投影字段或自行填写另一个版本、Tag、分支、资产名。

从仓库根目录执行：

| 用户意图 | 命令 |
| --- | --- |
| 检查版本、查看派生名 | `npm run release:check` |
| 升级版本 | `npm run release:version -- patch`、`minor`、`major` 或用户指定的完整 SemVer |
| 创建 release 分支 | `npm run release:branch` |
| 本地创建发布 Tag | `npm run release:tag` |
| 明确要求推送 Tag | `npm run release:tag -- --push` |
| 构建产物后核验 | `npm run release:verify` |
| 发布当前版本 | `npm run release:publish` |

本次仅迁移已有产物到 GitHub Releases 时，沿用当前版本，不擅自 bump。用户未给具体升级值时，可按改动提出建议；无法从上下文确定破坏性影响时先澄清，其他已授权工作继续推进。

## 发布流程与边界

1. 用脚本设置版本（若本次需要），完成代码/文档，运行相关回归并提交。正式发布入口要求干净工作区，当前分支只能是 `main` 或当前版本派生的 release 分支。
2. `release:publish` 自动检查投影、忽略规则、已存在的 Tag/Release，构建 ZIP，运行完整测试，再次核对 HEAD 未变化；通过后正常推送当前分支，创建并推送准确指向该 HEAD 的 Tag。
3. 先创建 draft Release，仅上传当前版本的 ZIP、逐文件 manifest、SHA-256 文件；重新下载并校验三份资产后才公开发布。预发布版本按 SemVer 标记 prerelease，正式版本标记 latest。
4. 最后报告 Release URL、Tag、提交 SHA、资产与哈希。核对远端 `release/` 与 `.codex-tracking/` 均不存在。

`release/` 只有本地用途，内部忽略文件必须保持 `*`；不上传通配符目录、私有记录、测试或构建缓存。不要把“创建 release 分支”或“升级 version”的请求扩成外部发布。

脚本会拒绝版本漂移、脏工作区、私有/产物被 Git 跟踪、错误 Tag 目标和重复 Release。若外部操作失败或结果未知，先读取现有 Tag、Release 和资产状态；在原有授权内完成明确缺失的步骤，不盲目重发创建命令，不使用 `--clobber` 或 force。移动 Tag、替换已发布内容需要用户明确授权，已有授权不重复询问。

详细约束与验收见 [版本与发布说明](../../../docs/notes/release-version.md)。脚本只绑定当前技能所在仓库，不接受任意目标仓库或独立版本覆盖参数。
