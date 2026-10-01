# 迁移规划

将 Python BansoAgain 的新闻研究能力逐步迁移到 DSH，在学习框架的同时保留关键业务语义，优先复用默认 agent loop。

## 第一阶段：Tavily 搜索插件

复用 `ctx.web` 和现有 `web_search`，实现 Tavily provider，由统一的 Banso bundle 依赖、加载并选用。

- 完成插件安装、配置和 provider 选择。
- 适配搜索请求与来源结果，处理错误和取消。
- 验证默认工具链路，记录与 BansoAgain 的语义差异。

## 后续方向

逐步实现阅读、证据管理和带引用的回答。具体方案在进入相应阶段时确定，暂不预定所有组件的语言边界或最终拆包方式。

## 当前状态

已编写 Tavily provider 初版，并逐步初始化 pnpm workspace、安装依赖及生成锁文件。`packages/web-search-tavily` 只提供插件，`packages/banso` 持有统一 bundle 的组合配置，根包负责工程命令。

当前以 DSH CLI `0.2.0-rc.2` 为待验证的兼容目标，已将 `dsh-web` 和 `dsh-launch-environment` 的开发依赖及 peer 声明对齐到 `0.2.0-rc.2`，并核对锁文件和实际安装版本。阅读新版类型声明后，未发现当前实现所用接口不匹配；web 服务类名与参考源码均为 `WebRuntime`。此结论仅来自文件阅读；尚未新增测试或执行类型检查、构建、profile 安装及真实 API 验证。第一阶段尚未验收，后续验证按讨论结果推进。
