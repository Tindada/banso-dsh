# 迁移规划

将 Python BansoAgain 的新闻研究流程迁入 DSH，在学习框架的同时保留关键业务语义。当前仍处于首版开发，范围不含本地语料库，优先复用 DSH 已有能力。

待优化项见 [优化 TODO](todos.md)。

## 当前能力

2026-10-27，materials 从独立仓库提交 `0619a28` 迁回 `packages/materials/`，版本保留 `0.1.3`，包含来源引用规则和搜索包装作用域修复。Banso 使用 `workspace:*` 依赖；materials 继续作为独立 npm 包和 bundle 维护。

开发基线为 DSH `0.2.1-rc.2`、Cordis `4.0.5`，对外兼容范围为 `>=0.2.1-rc.2 <0.3.0-0`。自建 Web/UI 已停止维护并从源码删除，Web 改用官方界面与 [Banso preset](../packages/preset/README.md)；SDK 入口保留。旧 profile 和会话文件不删除，也不自动迁移。下文保留历史验证与发布记录。项目使用 pnpm workspace：

- `base` 提供 SDK 环境和默认 agent loop；`banso` 组合业务插件，profile 只加载 `banso-dsh`。基础 patch 在 base 维护，构建时复制到 banso。
- SDK bundle 搜索默认使用官方 `deepseek-search-api`，保留 `web-search-tavily` 作为可选 provider；网页抓取默认使用 `web-fetch-jina` 接入 Jina Reader，可通过 `fetchProvider: deepseek-fetch-api` 切换到 DeepSeek Fetch。
- Web 的 Banso preset 继承宿主 `web` 服务和 provider 选择，不再创建隔离服务或自动注册 Jina；研究工具与 materials 保留在 preset 作用域内。
- `prompt` 提供研究规则和每轮固定的 UTC 参考时间。用户通过消息指定历史日期或研究范围。参考时间按 agent 保存在内存中，恢复后的下一轮重新生成，研究中途热重载不保证保留原时间。
- `materials` 统一提供 `web_read({target, mode, focus?})`，每次显式选择 direct（正文）或 extract（按非空 focus 提取证据）。自动获取或复用正文，不再支持启动时的 readMode 或 BANSO_WEB_READ_MODE；evaluation 移除对应覆盖和 manifest 字段，旧实验不可直接续跑。
- `materials` 包装原生 search 的短回执；read 使用扁平结果记录模式、可选正文、证据及错误。extract 默认沿用主模型，可独立配置；输入超预算报错，不分块。direct 不调用提取 LLM。Banso 关闭原生 fetch 工具，加载 DSH 工具超时策略。
- `materials` 从工具日志保存正文、稳定 handle 和按 focus 追加的证据；提供 `materials_hide(handles)` 批量隐藏快照条目，保留底层材料，再次搜索命中同一 URL 或有效阅读结果会自动重新展示。全部隐藏时用空快照替换旧快照。提取失败保留正文与旧证据；extract 快照不展示全文，有证据后隐藏 snippet；direct 快照展示正文，有正文后隐藏 snippet，旧快照替换为占位。支持 JSONL 恢复和插件重载。

`stateVersion` 为 `2`，材料逐条记录 displayMode，同一 session 可切换或混合阅读方式。不支持旧 web_fetch 或无 mode 的 web_read 日志恢复；升级后使用新会话。首版没有刷新／过期、证据去重／合并、长文分块、上下文总量控制、长期资料库或引用语义校验。

协议与行为详见 [网页工具与资料插件](../packages/materials/README.md) 和 [提示词插件](../packages/prompt/README.md)。

materials 内置 search/read 共享预算，默认每 turn 15 次，按工具调用尝试计数；工具列表过滤和执行 guard 提供严格执行上限。预算与材料共用 projection 和快照，stateVersion 保持 2。

## 验证范围

2026-10-27 迁回验证：workspace 类型检查与构建、materials 49 项、Banso 6 项和 Web 6 项测试通过。实际打包确认 MIT LICENSE 随包分发、Banso 的 materials 依赖转换为 `0.1.3`。测试使用 DSH `0.2.1-rc.2`、模拟模型/provider、本地 HTTP 服务及 Chromium；未验证在线服务或全新机器安装，未发布 npm。

materials 增加单插件 bundle 声明和随包加载 patch，现有 Banso 继续自行注册 materials，不在同一 profile 重复启用两种入口。本次包编译、类型检查和 47 项 materials 测试通过；新增测试使用 npm 打包并解包实际产物，经 DSH `0.2.1-rc.2` CLI 合成标准 Web 与 Banso 配置，确认每种组合各含一个 materials 注册项。另已人工验证本地 bundle 在标准 DSH Web 中安装、启用，以及搜索和直接阅读正常；未发布新 npm 版本。

materials 自动禁用原生 `web_fetch` 后，包内类型检查、编译和 46 项测试通过，Banso 6 项组合测试通过。本次直接执行包脚本对应的本地 `tsc` 和 `node --test` 命令；Banso 本地 HTTP 测试在允许监听端口的环境下运行。新增覆盖宿主、preset 父作用域和 agent 自有 fetch 的工具列表过滤、执行拒绝、提示词清理、加载顺序、卸载恢复及重载；direct/extract 仍可调用底层抓取服务。使用模拟 provider，未进行标准 DSH Web 浏览器端到端或在线服务验证。保留 Banso 的 `fetch: false` 配置，不更改会话协议和研究预算计数。

共享研究预算实现后，workspace 类型检查、构建及 materials（40 项）、banso（6 项）测试通过。覆盖严格执行上限、异步前置检查顺序、预算快照、跨 turn 重置、隔离与卸载、日志重放和 JSONL 恢复；使用模拟模型与 provider，未运行付费在线评估。

以下记录各阶段的验证结果，测试数量以当时为准。当前开发与验证命令见 [开发文档](development.md)。

早期 workspace 构建、类型检查及 44 项本地测试已通过。功能包验证各自行为及框架集成；materials 覆盖批量隐藏、数据保留、搜索／阅读重新展示及空快照替换。banso 组合测试手动加载真实插件，使用模拟模型和网页 provider、默认 loop 与 JSONL 后端，覆盖工具输出、资料快照、并发抓取、恢复后继续调用及参考时间共存。Jina provider 使用本地 HTTP 服务验证请求、错误、截断、取消与生命周期，并在 banso 组合层验证 Markdown 经 handle 抓取后交给提取器，正文不会进入主模型快照。测试不调用在线服务，也不经过 bundle 配置或 SDK 启动入口，未验证真实模型自主隐藏材料的效果。

两种阅读模式开发时使用模拟服务验证工具注册、正文复用、隐藏恢复、JSONL 恢复和继续读取；direct 断言提取调用为零。新增 evaluation 测试覆盖模式配置、环境覆盖、manifest 及续跑拒绝，不据此判断真实模型成本或质量收益。

早期版本已人工验证配置合成、Python SDK 调用和搜索／阅读。当前 handle 版本在 SDK 试跑中发现的参数 schema 错误已修复并增加回归断言，修复后的 HTTP provider 版本已检查 SDK 实际运行日志，搜索、handle／URL 抓取和资料快照流程符合预期。

2026-10-08 已在本机独立目录安装 npm DSH `0.2.0-rc.2` 和七个 Banso tarball，使用独立 DSH home、Python SDK `0.1.5rc1` 及显式 `dsh_bin` 完成简单回答与真实搜索／阅读试跑。事件记录确认一次搜索返回八个来源，两次阅读分别使用 handle 和直接 URL，均抓取并提取证据成功，资料快照更新且正常结束。该路径不从源码仓库启动；当时未验证 npm 正式发布后的依赖安装，后续验证见下方发布状态。此试跑未覆盖全新机器或会话恢复。

[GISA 测评](../evaluation/README.md) 已实现题目准备、SDK 批量答题和独立离线评分，单题与多题统一使用 `banso_eval.batch`，底层保留 `answer_case()`。正式题库已下载解密（373 题，revision `417bdcd235bddfd4722a39cc0ae58b41307e5edd`）；58 项 Python 本地测试通过，两组旧运行的 120 条逐题评分用当前答案重评后均与旧记录一致。

截至 2026-10-09，固定 60 题已完成在线测评，覆盖四种答案类型。首轮 55 题 `ok`，global EM 为 9/60；另行重跑 5 道失败题均成功，按 ID 替换后的合并结果为 60 题 `ok`、global EM 11/60、table row F1 0.4907。合并结果包含额外尝试，不代表首轮表现；运行记录保存在本地 `evaluation/runs/`。

[BansoAgain 原实现梳理](banso-original.md) 已完成源码对照，区分代码约束、提示词要求和现有局限；尚未运行原项目测试或在线评测。

## 自建 Web 历史

2026-10-15 至 2026-10-21，曾维护 `banso-dsh-web` 和 `banso-dsh-ui`，实现聊天、工具展示、Markdown/KaTeX、会话历史与重命名。最后一轮 UI 18 项、Web 6 项回归在模拟服务和 Chromium 下通过；既有发布及在线验证见下方记录。

2026-10-27 删除这两个源码包和仅验证自建页面的测试，开发入口改为官方 Web profile。历史实现可从 Git 记录恢复，已发布 npm 包仍保留。

## 发布状态

2026-10-28 用户确认已发布并查询验证 `banso-dsh-preset@0.1.1`。该版本继承宿主 `web` 服务和 provider 配置，移除内部隔离服务及 Jina 自动注册；依赖 prompt `0.1.2`、materials `0.1.4`。发布前类型检查、构建及 56 项模拟测试通过；桌面端源码链接会话日志确认抓取使用 DeepSeek Fetch API。本次发布后的独立 npm 安装验证通过。

2026-10-27 已发布 `banso-dsh-preset@0.1.0`、`banso-dsh-materials@0.1.4`、`banso-dsh-prompt@0.1.2` 和 `banso-dsh-web-fetch-jina@0.1.2`。用户从 npm 安装 preset 后确认官方 Web 可以正常使用；入口包自动获取上述业务依赖。本次未发布 SDK 入口及其他包，未覆盖全新机器、所有平台或完整功能。npm 安装步骤见[安装文档](install-npm.md#官方-web)。

2026-10-19 已发布 `banso-dsh-materials@0.1.2`，包含搜索作用域适配、自动禁用原生 fetch 和独立 bundle 支持。已人工验证从 npm 安装该版本，在标准 DSH Web 中搜索与直接阅读正常。其他包未随本次升版，已发布的 Banso 包不会因此自动使用新版 materials。

2026-10-09 七个包已发布 `0.1.0`。本机独立目录从 npm 安装 DSH 后，仅指定入口包 `banso-dsh@0.1.0`，其余六包自动获取；完成配置合成和 Python SDK 在线验证，一次搜索返回八个来源，两次网页抓取及证据提取成功，正常结束。profile 中需单独批准 koffi 构建；missing peer 提示与 DSH 从宿主解析依赖的设计有关，本次运行未受影响。此验证不使用源码链接或 tarball，但未覆盖全新机器和完整功能。

2026-10-16 完成本轮发布：

| 包 | 发布版本 |
| --- | --- |
| `banso-dsh`、`banso-dsh-base`、`banso-dsh-prompt`、`banso-dsh-materials`、`banso-dsh-web-fetch-jina`、`banso-dsh-web-search-tavily` | `0.1.1` |
| `banso-dsh-web`、`banso-dsh-ui` | `0.1.0`（首次发布） |

发布前，用户完成依赖安装、类型检查、构建和包测试；检查八个 pnpm tarball 的依赖版本、入口、README、LICENSE 和第三方声明。在仓库之外使用独立 DSH home/profile 安装本次 tarball，用户确认 Python SDK 搜索阅读脚本和 Web 验证通过。

发布后，在新的临时工作目录从 npm 安装 DSH `0.2.0-rc.2`，只指定 `banso-dsh@0.1.1` 和 `banso-dsh-web@0.1.0` 两个入口包，不使用 overrides、tarball 或源码链接。分别批准工作目录的 DSH 依赖构建和 profile 中的 koffi 构建，再切换 bundle 组合验证 SDK 与 Web；用户确认两条路径均通过。Python SDK 使用 `0.1.5rc1`。

本次覆盖本机独立目录安装和真实服务试跑，不等同于全新机器、所有平台或完整功能验证。安装、配置和启动需使用同一个 `DSH_HOME`；SDK 显式传入的 `dsh_home` 也必须与之对应。

npm 安装步骤见 [安装文档](install-npm.md)，源码开发见 [开发文档](development.md)，打包检查见 [发布文档](releasing.md)。
