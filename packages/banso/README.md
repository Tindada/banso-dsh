# Banso 业务 bundle

`banso-dsh` 组合精简 SDK 基础环境、Tavily 搜索、Jina Reader 抓取和 [Banso 提示词插件](https://github.com/Tindada/banso-dsh/blob/main/packages/prompt/README.md)，向 agent 提供 `web_search`、按模式选择的阅读工具、研究规则和每轮固定的 UTC 参考时间。业务 profile 只加载本包；基础配置已包含在内，不要再同时加载 `banso-dsh-base`。

本包在配置中直接将 persona 设为新闻研究助手，并开启 runtime context。参考时间自动取自服务器；指定历史日期或研究范围直接写在用户消息中。

本包由 Banso 项目独立维护，非 DeepSeek 官方发行包。随包分发的 `base.patch.yml` 改编自 DSH 的 `sdk-minimal` 配置，遵循 MIT；构建和打包时同步生成的 `THIRD_PARTY_NOTICES.md` 保留其完整上游许可声明。

[会话资料插件](https://github.com/Tindada/banso-dsh/blob/main/packages/materials/README.md) 提供阅读、材料隐藏和资料快照。组合关闭原生 fetch 工具，并加载 DSH 工具超时策略；工具协议、正文复用和证据保存行为见该插件说明。

## 阅读模式

组合将环境变量 `BANSO_WEB_READ_MODE` 传给 materials 的 `readMode`，默认 `extract`：

- `extract` 注册 `web_read(target, focus)`，快照展示提取证据。
- `direct` 注册自定义 `web_fetch(target)`，快照展示格式化正文，不调用提取模型。

每次运行固定模式，切换时创建新 session，恢复时使用相同模式。

## 安装与启动

安装、密钥配置和 Python SDK 示例见 [项目安装说明](https://github.com/Tindada/banso-dsh/blob/main/README.md)。

启动后提供 SDK stdio JSON-RPC 服务，没有聊天界面；客户端可负责启动和关闭服务。Web 聊天使用独立的 `banso-dsh-web` 组合。

## 运行配置

搜索配置见 [Tavily provider](https://github.com/Tindada/banso-dsh/blob/main/packages/web-search-tavily/README.md)，阅读配置见 [Jina provider](https://github.com/Tindada/banso-dsh/blob/main/packages/web-fetch-jina/README.md)。组合保留 HTTP provider，可将 web 插件的 `fetchProvider` 改为 `http`。修改 profile patch 后重启运行环境。

会话默认保存到 `~/.dsh/sessions-banso-base`，可通过 `DSH_HOME` 更换 home 位置。

源码构建、链接 profile 和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。
