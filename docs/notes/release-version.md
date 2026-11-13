# 版本与发布

状态：当前有效｜日期：2026-11-13｜依据：[ADR-0006](../adr/0006-version-authority-and-github-releases.md)

版本发布、升级、新 Release、release 分支或 Tag 任务，先使用项目技能 [release-version](../../.agents/skills/release-version/SKILL.md)。该技能是操作入口；下表解释脚本边界，不另定义版本。

| 数据 | 来源 |
| --- | --- |
| 项目版本 | `package.json.version`，唯一可维护来源 |
| 插件 manifest、lockfile 项目版本 | 由版本脚本同步并校验的投影 |
| 服务端版本、测试包路径 | 读取 package.json，不硬编码项目版本 |
| Tag / release 分支 | 版本脚本派生，分别使用 `v` 前缀与 `release/` 前缀 |
| ZIP / manifest / SHA-256 | 从包名和版本派生，本地存入忽略的 `release/` |

当前版本若已正确，不因“迁移发布位置”自行升级。需要升级时通过技能的版本命令选择 patch/minor/major 或完整 SemVer，避免手改投影。

发布命令要求干净工作区。先检查源版本、目录忽略、Tag/Release 状态，再构建、完整测试；确认 HEAD 和工作区未变化后正常推送分支及 Tag。draft Release 上传仅限三个派生资产，下载后的校验和匹配才公开。正式版本标记 latest，预发布版本标记 prerelease。

已存在同版本 Release 或不匹配的 Tag 必须核对后处理，禁止隐式移动、覆盖或追加错误版本资产。操作失败时如实记录已完成的外部步骤，再判断恢复方式；不能把上传了一部分当作发布成功。

GitHub 按 Tag 的 REST 接口可能对 draft 返回 404，状态判断使用分页 Release 列表。已有完整资产的未公开 draft 可按技能的 `--resume` 入口恢复：冻结原源提交和 Tag，检查当前代码没有改变分发输入，并重新下载核对所有资产；仅发布控制脚本等非分发输入修复可继续，不能借恢复流程移动 Tag、换包或覆盖已公开 Release。

下载入口：[GitHub Releases](https://github.com/nblog/qwen-weknora/releases)。仓库文件树不再提供 `release/` 目录；源码构建和测试仍可使用本地同名目录。
