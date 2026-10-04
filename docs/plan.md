# 迁移规划

将 Python BansoAgain 的新闻研究流程迁入 DSH，在学习框架的同时保留关键业务语义。当前范围不含本地语料库，优先复用 DSH 已有能力，不逐类照搬 Python 实现。

## 当前进度

基础运行与网页能力已接通：

- `packages/base` 提供精简 SDK 环境和默认 agent loop。
- `packages/web-search-tavily` 提供 Tavily 搜索 provider，网页阅读复用 DSH HTTP Fetch。
- `packages/banso` 组合基础配置与网页工具；业务 profile 只加载 `banso-dsh`。构建时自动复制基础 patch，源文件只在基础包维护。
- 依赖对齐 DSH `0.2.0-rc.2`，使用 pnpm workspace。构建与类型检查已通过；用户已确认基础包和完整组合的配置检查、Python SDK 调用，以及新组合的搜索、阅读测试成功。

上述验证不覆盖全部分支；错误、取消、重试触发、重启恢复及 npm CLI 安装版兼容性尚未单独验证。

## 下一阶段：完整研究流程

目标：在 DSH 中完成从研究问题、资料收集、证据整理到带引用结果的完整流程。

1. **梳理原实现（已完成源码梳理）**：见 [BansoAgain 原实现梳理](banso-original.md)，涵盖入口、决策、动作、状态更新、证据提取、笔记、综合及迁移对照，并区分代码约束、提示词要求与现有局限。本次未运行原项目测试或在线评测。
2. **首版接入方式（已实现）**：复用默认 loop、web_search 和 web_fetch，新增 `banso-dsh-prompt`，通过 section 提供适配现有能力的研究规则，通过 context 提供每轮固定的 UTC 参考时间。Banso bundle 设置新闻研究 persona 并开启 runtime context；基础包保持通用。不新增 SDK 时间参数，用户指定的历史时间直接通过消息表达。
3. **实现首个完整版本**：先跑通一条研究流程，再用原项目的典型任务检查时间范围、来源、证据与引用，以及结束行为；按实际需求补齐失败处理等能力。

本次（2026-10-04）完成 workspace 类型检查、构建、使用 DSH 官方 patch 合成函数检查 bundle 配置，以及 4 项模拟模型集成测试，覆盖首步时间、同轮补充消息、工具调用、重试、跨轮更新、agent 隔离和插件卸载重载。未调用在线服务；下一步用真实研究问题检查提示词效果，再决定需要补充的业务能力。

已新增 `banso-dsh-materials`：从现有 `tool/call`、`tool/result` 维护会话资料投影，保存搜索元数据、成功抓取文本与最近抓取状态，并分配稳定 handle。通过真实网页工具、模拟 provider 和 JSONL 后端验证恢复前后资料一致；本次共 6 项资料测试，不调用在线服务。资料尚未进入模型上下文，现有工具仍使用 URL。详见 [资料插件说明](../packages/materials/README.md)。

当前研究规则仍依赖模型遵循，尚无独立证据库、正文证据隔离、业务预算和引用语义校验。参考时间状态按 agent 保存在内存中；恢复后的下一轮重新生成，不保证研究中途热重载恢复原时间。详见 [提示词插件说明](../packages/prompt/README.md)。

## 暂缓事项

打包发布不作为业务迁移的前置条件。目前使用本地链接，实际 tarball 尚未验证，也未发布。后续发布需检查双 patch 产物、处理基础包的 `private` 标记，并确保基础包和 Tavily provider 的对应版本可安装。

运行步骤见 [基础包说明](../packages/base/README.md) 和 [Banso 使用说明](../packages/banso/README.md)。
