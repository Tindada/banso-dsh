# Banso 最小 Web 聊天

`banso-dsh-web` 是追加在 `banso-dsh` 后的 Web bundle。它在自己的 patch 中停用 SDK 启动和 stdio 服务，不修改基础包或业务包；复用 DSH 的通信、会话对象、持久化和前端启动壳。

本包组合 `banso-dsh-ui` 提供 Web 聊天。安装、密钥配置、启动和端口设置见 [Web 聊天使用说明](https://github.com/Tindada/banso-dsh/blob/main/README.md#web-聊天源码安装)，界面行为和限制见 [UI 说明](https://github.com/Tindada/banso-dsh/blob/main/packages/ui/README.md#展示与限制)。

修改 profile 配置后需重启服务。

## 组合和存储

- profile 中的 bundle 顺序必须是 `banso-dsh`、`banso-dsh-web`，不要同时加载 `banso-dsh-base` 或官方 `dsh-web-app`。
- 搜索使用官方 `deepseek-search-api`，直接调用 DeepSeek Search API，默认复用 `DEEPSEEK_API_KEY`；保留返回的短摘要 `snippet`，尚不保留长摘要 `summary`。阅读继续使用 Jina。
- 会话沿用 `DSH_HOME/sessions-banso-base`（默认 `~/.dsh/sessions-banso-base`）。工作区元数据和附件放在 `DSH_HOME/banso-web/`。
- `attachment-local`、`file-upload`、`commands` 及工作区存储来自官方会话接口的依赖，即使前端不显示这些功能也需要加载。文件系统和工作目录服务由 base 提供。
- `remote-access` 为 Gateway、会话接口和会话 UI 提供访问权限服务；正常认证的主人浏览器使用 owner 权限，无需额外配置授权规则。
- `ui-renderer` 负责根页面渲染；`ui-session` 只提供 renderer 所需的会话作用域适配；`banso-dsh-ui` 是唯一页面。未加载官方 chat、layout、sidebar 等界面。
- 网页直接连接 Node.js DSH 服务，不经过 Python SDK；SDK 原 profile 继续使用原有组合。

构建和浏览器集成验证见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。
