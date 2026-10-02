# 迁移规划

将 Python BansoAgain 的新闻研究能力逐步迁移到 DSH，在学习框架的同时保留关键业务语义，优先复用默认 agent loop。

## 第一阶段：Tavily 搜索插件

复用 `ctx.web` 和现有 `web_search`，实现 Tavily provider，由统一的 Banso bundle 依赖、加载并选用。

- 完成插件安装、配置和 provider 选择。
- 适配搜索请求与来源结果，处理错误和取消。
- 验证默认工具链路，记录与 BansoAgain 的语义差异。

## 后续方向

以 `packages/base` 的精简 SDK 组合为底座，保留默认 loop 和 17 个启用插件。业务包通过 build / prepack 复制基础 patch，业务 profile 只加载 `banso-dsh`，由业务层提供网页能力；旧 banso-web profile 不再作为兼容目标。

逐步实现阅读、证据管理和带引用的回答。具体方案在进入相应阶段时确定，暂不预定所有组件的语言边界或最终拆包方式。

## 当前状态

已编写 Tavily provider 初版，并逐步初始化 pnpm workspace、安装依赖及生成锁文件。`packages/web-search-tavily` 只提供插件，`packages/banso` 持有统一 bundle 的组合配置，根包负责工程命令。

开发依赖及 peer 声明已对齐 DSH `0.2.0-rc.2`。通过 pnpm `packageExtensions` 补齐该版本 `dsh-llm` 类型声明引用但未作为使用方依赖声明的 `dsh-attachment`。

用户已确认构建通过（包含 TypeScript 检查），并在本地 DSH 源码宿主的 `banso-web` profile 中完成 Banso bundle 加载和真实 Tavily 搜索。默认搜索链路已跑通；尚未执行自动化测试，也未验证错误、取消分支或 npm CLI 安装版兼容性。

基础包的配置、依赖声明与说明已迁入，根锁文件已更新，原实验目录保留。迁入配置完成静态对照；用户提供的 banso-base 配置输出确认仅加载本 bundle 的 17 个插件，并确认运行 DSH 源码仓库的 `python/sdk/call_dsh.py` 正常。重试触发、重启恢复及 npm CLI 安装版兼容性未单独验证。步骤见 `packages/base/README.md`。

业务 bundle 已改为显式加入 web 服务、Tavily provider、HTTP Fetch provider 和 web 工具，并声明所需的 DSH `0.2.0-rc.2` 依赖。Tavily 实现不变。新依赖由用户安装并更新锁文件，新组合的 profile 加载及真实搜索、阅读仍待验证，步骤见 `packages/banso/README.md`。

Banso 已声明对基础包的 workspace 依赖，并通过双 patch 入口提供完整组合。基础 patch 是自动生成文件，不手工维护或提交；打包前自动刷新。复制脚本已在临时目录验证依赖解析、准确复制和覆盖旧文件；根锁文件已记录主包对基础包的新增依赖，base.patch.yml 已生成并确认与源文件一致、被 Git 忽略，复制脚本在实际 workspace 中执行成功。实际打包和新组合的运行验证待完成，未发布任何包。

## 分发约定（待验证）

当前主要采用 workspace 本地链接。Banso 的 build / prepack 从基础包复制配置，按基础、业务的顺序加载两份 patch；基础配置只维护一份源文件。

准备分发时，在安装、构建完成后执行 `pnpm --filter banso-dsh pack`，检查产物包含两份 patch 和复制脚本。依赖不内嵌在主包中，workspace 声明由 pnpm 打包时转换为版本。正式发布前需处理基础包的 `private: true`，并确保基础包和 Tavily provider 的对应版本可从目标 registry 安装。
