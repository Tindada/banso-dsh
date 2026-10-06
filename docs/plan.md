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

早期版本已人工验证配置合成、Python SDK 调用和搜索／阅读。当前 handle 版本在 SDK 试跑中发现的参数 schema 错误已修复并增加回归断言，修复后的 HTTP provider 版本已检查 SDK 实际运行日志，搜索、handle／URL 抓取和资料快照流程符合预期；Jina 在线抓取尚未实测。本次 read／证据提取版本尚未做 SDK 在线实测；真实研究质量、npm CLI 安装版和发布包兼容性尚未验证。

## 下一步

1. 通过 SDK 实测当前 search → read → evidence 流程，检查 Jina 正文质量、证据准确性与追问效果。
2. 用原项目的典型研究任务检查时间范围、来源、证据、引用和结束行为。
3. 根据实测再决定长文分块、证据增长控制和刷新需求。

[BansoAgain 原实现梳理](banso-original.md) 已完成源码对照，区分代码约束、提示词要求和现有局限；尚未运行原项目测试或在线评测。

## 暂缓事项

打包发布不作为业务迁移的前置条件。目前使用本地链接，尚未验证 tarball 或发布。发布前需检查双 patch 产物、基础包的 `private` 标记，以及依赖包的可安装性。

运行步骤见 [基础包说明](../packages/base/README.md) 和 [Banso 使用说明](../packages/banso/README.md)。
