# 迁移规划

将 Python BansoAgain 的新闻研究流程迁入 DSH，在学习框架的同时保留关键业务语义。当前仍处于首版开发，范围不含本地语料库，优先复用 DSH 已有能力。

## 当前能力

依赖对齐 DSH `0.2.0-rc.2`，使用 pnpm workspace：

- `base` 提供 SDK 环境和默认 agent loop；`banso` 组合业务插件，profile 只加载 `banso-dsh`。基础 patch 在 base 维护，构建时复制到 banso。
- `web-search-tavily` 提供搜索，网页抓取默认使用 `web-fetch-jina` 接入 Jina Reader，保留 DSH HTTP Fetch，可通过 `fetchProvider: http` 切回。
- `prompt` 提供研究规则和每轮固定的 UTC 参考时间。用户通过消息指定历史日期或研究范围。参考时间按 agent 保存在内存中，恢复后的下一轮重新生成，研究中途热重载不保证保留原时间。
- `tool-web` 包装原生 search 的短回执，并独立提供 `web_read(target, focus)`。直接调用 web 服务抓取，已有正文则复用，再用一次 LLM 调用提取紧凑证据。默认沿用主模型，可独立配置；输入超预算报错，不分块。read 使用扁平结果：可选正文、证据和错误信息，不维护抓取／提取状态枚举。Banso 关闭原生 fetch 工具，加载 DSH 工具超时策略。
- `materials` 从工具日志保存正文、稳定 handle 和按 focus 追加的证据。提取失败保留正文与旧证据；快照不展示全文，有证据后隐藏 snippet，旧快照替换为占位。支持 JSONL 恢复和插件重载。

`stateVersion` 保持 `1`，直接替换旧 fetch 协议，不做兼容或历史迁移。首版没有刷新／过期、证据去重／合并、长文分块、上下文总量控制、长期资料库、业务预算或引用语义校验。

协议与行为详见 [网页工具](../packages/tool-web/README.md)、[资料插件](../packages/materials/README.md) 和 [提示词插件](../packages/prompt/README.md)。

## 验证范围

workspace 构建、类型检查及 36 项本地测试已通过。功能包验证各自行为及框架集成；banso 组合测试手动加载真实插件，使用模拟模型和网页 provider、默认 loop 与 JSONL 后端，覆盖工具输出、资料快照、并发抓取、恢复后继续调用及参考时间共存。Jina provider 使用本地 HTTP 服务验证请求、错误、截断、取消与生命周期，并在 banso 组合层验证 Markdown 经 handle 抓取后交给提取器，正文不会进入主模型快照。测试不调用在线服务，也不经过 bundle 配置或 SDK 启动入口。

早期版本已人工验证配置合成、Python SDK 调用和搜索／阅读。当前 handle 版本在 SDK 试跑中发现的参数 schema 错误已修复并增加回归断言，修复后的 HTTP provider 版本已检查 SDK 实际运行日志，搜索、handle／URL 抓取和资料快照流程符合预期。

2026-10-08 已在本机独立目录安装 npm DSH `0.2.0-rc.2` 和七个 Banso tarball，使用独立 DSH home、Python SDK `0.1.5rc1` 及显式 `dsh_bin` 完成简单回答与真实搜索／阅读试跑。事件记录确认一次搜索返回八个来源，两次阅读分别使用 handle 和直接 URL，均抓取并提取证据成功，资料快照更新且正常结束。该路径不从源码仓库启动；尚未验证全新机器、npm 正式发布后的依赖安装、会话恢复或系统性答案质量。

[GISA 测评](../evaluation/README.md) 在 Python SDK 外围实现题目输出要求、JSON 校验、TSV 转换、失败结果和逐条事件记录。它不读取标准答案、不评分、不自动重试；39 项本地测试已通过，使用模拟 SDK 验证格式、失败分类、会话隔离和事件保存。另用一道自建 `item` 题完成在线验收：一次搜索、一次官方页面阅读和证据提取成功，最终 JSON 转为 TSV，状态为 `ok`／`completed`。`set/list/table` 尚未在线验收，正式 GISA 题库和标准答案已下载并解密（373 题，revision `417bdcd235bddfd4722a39cc0ae58b41307e5edd`）。已补充固定旧版 60 题 ID 的批量入口、续跑和离线评分，58 项 Python 测试通过；两组旧 60 题预测用当前答案重评后，120 条逐题评分与旧记录一致。单题与多题统一使用 `banso_eval.batch` 命令行入口，`answer_case()` 保留为底层 Python API。题目准备、答题执行、离线评分通过文件衔接；评分不依赖 SDK 或答题模块。未启动新的正式在线测评。

## 下一步

1. 补充 GISA `set/list/table` 输出的少量 SDK 在线验收，使用固定的 60 题开展对照测评，并对齐标准答案与评分逻辑。
2. 用原项目的典型研究任务检查时间范围、来源、证据、引用和结束行为。
3. 根据实测再决定长文分块、证据增长控制和刷新需求。

[BansoAgain 原实现梳理](banso-original.md) 已完成源码对照，区分代码约束、提示词要求和现有局限；尚未运行原项目测试或在线评测。

## 暂缓事项

打包发布不作为业务迁移的前置条件。本地链接和独立目录 tarball 安装均已基本验证；未正式发布。发布前仍需处理包名、基础包的 `private` 标记和依赖发布顺序，并验证仅安装入口包时依赖可完整获取。

运行步骤见 [基础包说明](../packages/base/README.md) 和 [Banso 使用说明](../packages/banso/README.md)。
