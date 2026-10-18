# Banso 业务 bundle

`banso-dsh` 组合精简 SDK 基础环境、Tavily 搜索、Jina Reader 抓取和 [Banso 提示词插件](https://github.com/Tindada/banso-dsh/blob/main/packages/prompt/README.md)，向 agent 提供 `web_search`、`web_read`、材料隐藏和每轮固定的 UTC 参考时间。业务 profile 只加载本包；基础配置已包含在内，不要再同时加载 `banso-dsh-base`。

本包在配置中直接将 persona 设为新闻研究助手，并开启 runtime context；当前通过 `researchPrompt: ""` 关闭研究规则。参考时间自动取自服务器；指定历史日期或研究范围直接写在用户消息中。

本包由 Banso 项目独立维护，非 DeepSeek 官方发行包。随包分发的 `base.patch.yml` 改编自 DSH 的 `sdk-minimal` 配置，遵循 MIT；构建和打包时同步生成的 `THIRD_PARTY_NOTICES.md` 保留其完整上游许可声明。

[会话资料插件](https://github.com/Tindada/banso-dsh/blob/main/packages/materials/README.md) 提供阅读、材料隐藏和资料快照。组合关闭原生 fetch 工具，并加载 DSH 工具超时策略；工具协议、正文复用和证据保存行为见该插件说明。

## 阅读模式

统一提供 `web_read`，由模型在每次调用时选择：

- `web_read({target, mode: "extract", focus})` 提取指定证据，focus 必须非空。
- `web_read({target, mode: "direct"})` 展示格式化正文，不调用提取模型。

同一会话可逐次切换，自动抓取或复用正文，材料快照按条目展示最近成功阅读的模式。不再支持启动配置 `readMode` 或环境变量 `BANSO_WEB_READ_MODE`；旧 profile 如有该配置应删除。

## 安装与启动

安装、密钥配置和 Python SDK 示例见 [项目安装说明](https://github.com/Tindada/banso-dsh/blob/main/docs/install-npm.md#python-sdknpm-安装)。

启动后提供 SDK stdio JSON-RPC 服务，没有聊天界面；客户端可负责启动和关闭服务。Web 聊天使用独立的 `banso-dsh-web` 组合。

## 运行配置

搜索默认使用 [Tavily provider](https://github.com/Tindada/banso-dsh/blob/main/packages/web-search-tavily/README.md)，阅读默认使用 [Jina provider](https://github.com/Tindada/banso-dsh/blob/main/packages/web-fetch-jina/README.md)。也可通过 profile patch 独立选择 DeepSeek Search 或 Fetch，二者默认复用 `DEEPSEEK_API_KEY`：

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: deepseek-fetch-api
```

如需同时切换搜索，将 `searchProvider` 改为 `deepseek-search-api`；切回 Jina 时，将 `fetchProvider` 改为 `jina`。`config` 会整体替换，因此须同时保留搜索和阅读的选择。修改 profile patch 后重启运行环境。

会话默认保存到 `~/.dsh/sessions-banso-base`，可通过 `DSH_HOME` 更换 home 位置。

源码构建、链接 profile 和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。

组合默认启用 materials 的共享研究预算：每 turn 最多允许 15 次 search/read 调用尝试进入执行，失败和取消也消耗次数。可在 `banso-materials` 的配置中设置 `researchBudget`（非负安全整数，0 禁用研究调用）。尝试次数可能因被拒绝的调用超过额度；材料跨 turn 保留。详见 materials README 的共享研究预算说明。
