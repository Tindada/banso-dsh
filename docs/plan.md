# 迁移规划

将 Python BansoAgain 的新闻研究能力逐步迁移到 DSH，在学习框架的同时保留关键业务语义，优先复用默认 agent loop。

## 第一阶段：Tavily 搜索插件

复用 `ctx.web` 和现有 `web_search`，实现 Tavily provider，由统一的 Banso bundle 依赖、加载并选用。

- 完成插件安装、配置和 provider 选择。
- 适配搜索请求与来源结果，处理错误和取消。
- 验证默认工具链路，记录与 BansoAgain 的语义差异。

## 后续方向

先将 try-minimal 的精简 SDK 组合迁入 `packages/base`，作为独立的 `banso-dsh-base` 基础 bundle，保留默认 loop 和 17 个启用插件。先验证独立运行，再处理与 `packages/banso` 业务层的组合；当前业务 bundle 仍依赖宿主的网页服务，不能直接叠加到精简底座。

逐步实现阅读、证据管理和带引用的回答。具体方案在进入相应阶段时确定，暂不预定所有组件的语言边界或最终拆包方式。

## 当前状态

已编写 Tavily provider 初版，并逐步初始化 pnpm workspace、安装依赖及生成锁文件。`packages/web-search-tavily` 只提供插件，`packages/banso` 持有统一 bundle 的组合配置，根包负责工程命令。

开发依赖及 peer 声明已对齐 DSH `0.2.0-rc.2`。通过 pnpm `packageExtensions` 补齐该版本 `dsh-llm` 类型声明引用但未作为使用方依赖声明的 `dsh-attachment`。

用户已确认构建通过（包含 TypeScript 检查），并在本地 DSH 源码宿主的 `banso-web` profile 中完成 Banso bundle 加载和真实 Tavily 搜索。默认搜索链路已跑通；尚未执行自动化测试，也未验证错误、取消分支或 npm CLI 安装版兼容性。

基础包的配置、依赖声明与说明已迁入，根锁文件已更新，原实验目录保留。迁入配置完成静态对照；用户提供的 banso-base 配置输出确认仅加载本 bundle 的 17 个插件，并确认运行 DSH 源码仓库的 `python/sdk/call_dsh.py` 正常。重试触发、重启恢复及 npm CLI 安装版兼容性未单独验证。步骤见 `packages/base/README.md`。
