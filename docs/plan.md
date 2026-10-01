# 迁移规划

将 Python BansoAgain 的新闻研究能力逐步迁移到 DSH，在学习框架的同时保留关键业务语义，优先复用默认 agent loop。

## 第一阶段：Tavily 搜索插件

复用 `ctx.web` 和现有 `web_search`，实现可安装的 Tavily provider。

- 完成插件安装、配置和 provider 选择。
- 适配搜索请求与来源结果，处理错误和取消。
- 验证默认工具链路，记录与 BansoAgain 的语义差异。

## 后续方向

逐步实现阅读、证据管理和带引用的回答。具体方案在进入相应阶段时确定，暂不预定所有组件的语言边界或最终拆包方式。

## 当前状态

已完成初步源码了解与规划，并建立 `packages/web-search-tavily/` 目录骨架，包含 `src/` 和 `tests/`。尚未配置工程或实现插件，具体工作按用户后续安排推进。
