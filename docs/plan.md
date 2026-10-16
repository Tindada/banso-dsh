# 迁移规划

将 Python BansoAgain 的新闻研究流程迁入 DSH，在学习框架的同时保留关键业务语义。当前仍处于首版开发，范围不含本地语料库，优先复用 DSH 已有能力。

待优化项见 [优化 TODO](todos.md)。

## 当前能力

依赖对齐 DSH `0.2.0-rc.2`，使用 pnpm workspace：

- `base` 提供 SDK 环境和默认 agent loop；`banso` 组合业务插件，profile 只加载 `banso-dsh`。基础 patch 在 base 维护，构建时复制到 banso。
- `web-search-tavily` 提供搜索，网页抓取默认使用 `web-fetch-jina` 接入 Jina Reader，保留 DSH HTTP Fetch，可通过 `fetchProvider: http` 切回。
- `prompt` 提供研究规则和每轮固定的 UTC 参考时间。用户通过消息指定历史日期或研究范围。参考时间按 agent 保存在内存中，恢复后的下一轮重新生成，研究中途热重载不保证保留原时间。
- `materials` 支持启动时固定的 `readMode`：默认 `extract` 注册 `web_read(target, focus)` 并展示证据，`direct` 注册 `web_fetch(target)` 并展示正文，跳过提取 LLM；共用正文获取和保存逻辑。模式通过 Banso 的 `BANSO_WEB_READ_MODE` 传入，evaluation 只传 `.env` 显式覆盖，记录并校验 `manifest.runtime.read_mode_override`（未设置为 null）；实际生效配置读取留待后续。不支持同 session 中途切换，不新增正文截断或成本统计。
- `materials` 内的网页工具模块包装原生 search 的短回执，并独立提供 `web_read(target, focus)`。直接调用 web 服务抓取，已有正文则复用，再用一次 LLM 调用提取紧凑证据。默认沿用主模型，可独立配置；输入超预算报错，不分块。read 使用扁平结果：可选正文、证据和错误信息，不维护抓取／提取状态枚举。Banso 关闭原生 fetch 工具，加载 DSH 工具超时策略。
- `materials` 从工具日志保存正文、稳定 handle 和按 focus 追加的证据；提供 `materials_hide(handles)` 批量隐藏快照条目，保留底层材料，再次搜索命中同一 URL 或有效阅读结果会自动重新展示。全部隐藏时用空快照替换旧快照。提取失败保留正文与旧证据；extract 快照不展示全文，有证据后隐藏 snippet；direct 快照展示正文，有正文后隐藏 snippet，旧快照替换为占位。支持 JSONL 恢复和插件重载。

`stateVersion` 保持 `1`，现有 read 日志仍可回放，新增 fetch 事件支持不需要历史迁移。首版没有刷新／过期、证据去重／合并、长文分块、上下文总量控制、长期资料库、业务预算或引用语义校验。

协议与行为详见 [网页工具与资料插件](../packages/materials/README.md) 和 [提示词插件](../packages/prompt/README.md)。

## 验证范围

此前 workspace 构建、类型检查及 44 项本地测试已通过。功能包验证各自行为及框架集成；materials 覆盖批量隐藏、数据保留、搜索／阅读重新展示及空快照替换。banso 组合测试手动加载真实插件，使用模拟模型和网页 provider、默认 loop 与 JSONL 后端，覆盖工具输出、资料快照、并发抓取、恢复后继续调用及参考时间共存。Jina provider 使用本地 HTTP 服务验证请求、错误、截断、取消与生命周期，并在 banso 组合层验证 Markdown 经 handle 抓取后交给提取器，正文不会进入主模型快照。测试不调用在线服务，也不经过 bundle 配置或 SDK 启动入口，未验证真实模型自主隐藏材料的效果。

本次两种阅读模式使用模拟服务验证工具注册、正文复用、隐藏恢复、JSONL 恢复和继续读取；direct 断言提取调用为零。新增 evaluation 测试覆盖模式配置、环境覆盖、manifest 及续跑拒绝，不据此判断真实模型成本或质量收益。

早期版本已人工验证配置合成、Python SDK 调用和搜索／阅读。当前 handle 版本在 SDK 试跑中发现的参数 schema 错误已修复并增加回归断言，修复后的 HTTP provider 版本已检查 SDK 实际运行日志，搜索、handle／URL 抓取和资料快照流程符合预期。

2026-10-08 已在本机独立目录安装 npm DSH `0.2.0-rc.2` 和七个 Banso tarball，使用独立 DSH home、Python SDK `0.1.5rc1` 及显式 `dsh_bin` 完成简单回答与真实搜索／阅读试跑。事件记录确认一次搜索返回八个来源，两次阅读分别使用 handle 和直接 URL，均抓取并提取证据成功，资料快照更新且正常结束。该路径不从源码仓库启动；当时未验证 npm 正式发布后的依赖安装，后续验证见下方发布状态。此试跑未覆盖全新机器或会话恢复。

[GISA 测评](../evaluation/README.md) 已实现题目准备、SDK 批量答题和独立离线评分，单题与多题统一使用 `banso_eval.batch`，底层保留 `answer_case()`。正式题库已下载解密（373 题，revision `417bdcd235bddfd4722a39cc0ae58b41307e5edd`）；58 项 Python 本地测试通过，两组旧运行的 120 条逐题评分用当前答案重评后均与旧记录一致。

截至 2026-10-09，固定 60 题已完成在线测评，覆盖四种答案类型。首轮 55 题 `ok`，global EM 为 9/60；另行重跑 5 道失败题均成功，按 ID 替换后的合并结果为 60 题 `ok`、global EM 11/60、table row F1 0.4907。合并结果包含额外尝试，不代表首轮表现；运行记录保存在本地 `evaluation/runs/`。

[BansoAgain 原实现梳理](banso-original.md) 已完成源码对照，区分代码约束、提示词要求和现有局限；尚未运行原项目测试或在线评测。

## 最小 Web 聊天

2026-10-15 新增 `web`、`ui` 两个未发布包。`banso-web` profile 按顺序加载 `banso-dsh` 和 `banso-dsh-web`，由后者停用 SDK 启动和 stdio 插件，追加官方通信、会话接口及依赖；`base/`、`banso/` 源码不变。复用已发布 DSH 的静态启动壳、renderer、ui-session 作用域适配及浏览器会话对象层，自定义根页面提供纯文本聊天、连续追问、流式回答、停止和错误提示。

Web patch 默认选择官方 `deepseek-official` 搜索，加载 `dsh-web-search-deepseek`，搜索超时为 60 秒；阅读仍为 Jina，原 SDK 组合的 Tavily 默认值不变。

不提供历史列表、刷新恢复、Markdown 或资料面板。当前会话 ID 只存在页面内存，刷新后首次发送创建新会话；服务端 JSONL 持久化继续保留。刷新/关闭页面不等同于停止任务。

新增验证：消息投影单元测试、真实 DSH CLI + 临时 profile/home + 无头 Chromium 的聊天链路，以及 `--help` 不绑定端口。浏览器测试使用模拟模型，通过真实 HTTP/WebSocket、会话接口和默认 agent loop 验证流式回答、追问、取消、错误后继续聊天和刷新新建；模拟模型还检查 Banso 提示词及研究工具已加载。workspace 构建和类型检查、原有三项 Banso 组合回归测试通过。本机浏览器验证使用已有 Chromium 1208；未验证真实在线模型/搜索服务或全新机器安装。

使用步骤和构建依赖见 [Web 说明](../packages/web/README.md)。

Web 聊天已增加逐次搜索、阅读状态及可折叠详情，复用官方会话工具事件；执行期间显示并行调用及结果，本轮完成、失败或停止后隐藏；模型的工具调用说明仅临时显示，回答保留。不增加后端接口。

## 发布状态

2026-10-09 七个包已发布 `0.1.0`。本机独立目录从 npm 安装 DSH 后，仅指定入口包 `banso-dsh@0.1.0`，其余六包自动获取；完成配置合成和 Python SDK 在线验证，一次搜索返回八个来源，两次网页抓取及证据提取成功，正常结束。profile 中需单独批准 koffi 构建；missing peer 提示与 DSH 从宿主解析依赖的设计有关，本次运行未受影响。此验证不使用源码链接或 tarball，但未覆盖全新机器和完整功能。

用户安装步骤见 [项目 README](../README.md)，源码开发见 [Banso 使用说明](../packages/banso/README.md)。
