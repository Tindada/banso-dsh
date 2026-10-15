# Banso 最小 Web 聊天

`banso-dsh-web` 是追加在 `banso-dsh` 后的 Web bundle。它在自己的 patch 中停用 SDK 启动和 stdio 服务，不修改基础包或业务包；复用 DSH `0.2.0-rc.2` 的通信、会话对象、持久化和前端启动壳。

首版支持单会话文字聊天、连续追问、流式回答、停止和错误提示。回答为纯文本，不显示推理或资料面板；没有历史列表和刷新恢复。刷新后下一次发送会创建新会话。旧会话仍保存在服务端，刷新或关闭页面不保证取消任务，需要终止时请先点击停止。

聊天中显示每次搜索、阅读的进行中、完成、失败及取消状态；点击记录可查看关键词、关注点、URL 和错误详情。执行期间并行调用分别显示，重试时仍可查看之前的失败记录。仅展示整次调用，不区分下载／提取阶段。伴随工具调用的模型文字仅通过流式片段临时显示，当前步骤结束后消失；不含工具调用的回答保留完整消息。此区分基于消息中的工具调用块，不根据文字猜测。工具记录仅在本轮执行期间显示；本轮完成、失败或停止后全部隐藏，服务端日志仍保留。

## 从源码启动

准备 Node.js 24 和 pnpm 12.8.1，在仓库根目录运行：

```sh
pnpm install
pnpm build
```

两个新增包尚未发布，仅使用源码链接。以下命令中的 `/absolute/path/to/banso-dsh` 替换为仓库绝对路径：

```sh
./packages/web/node_modules/.bin/dsh plugin --profile banso-web add 'link:/absolute/path/to/banso-dsh/packages/banso'
./packages/web/node_modules/.bin/dsh plugin --profile banso-web add 'link:/absolute/path/to/banso-dsh/packages/web'
./packages/web/node_modules/.bin/dsh plugin --profile banso-web exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh","banso-dsh-web"]'
./packages/web/node_modules/.bin/dsh --profile banso-web --dump-config
./packages/web/node_modules/.bin/dsh --profile banso-web
```

Web 默认使用 DSH 官方搜索 provider `deepseek-official`，与主模型复用 `DEEPSEEK_API_KEY`，无需 `TAVILY_API_KEY`。阅读仍使用 Jina，可选设置 `JINA_API_KEY`。密钥放在仓库根目录 `.env`；默认主模型为 `deepseek-official / deepseek-flash`。官方搜索会额外调用辅助模型，搜索超时按 DSH 默认组合设为 60 秒。SDK profile 仍沿用原有 Tavily 配置。

在终端打开 `Banso Web:` 后的完整地址，包括本次进程的访问 token。默认仅监听 `127.0.0.1:3080`，不自动打开浏览器。更换端口或查看帮助：

```sh
./packages/web/node_modules/.bin/dsh --profile banso-web --port 3081
./packages/web/node_modules/.bin/dsh --profile banso-web --help
```

修改 UI 后重新运行 `pnpm build`，重启服务并刷新页面。当前不配置开发热更新。

## 组合和存储

- profile 中的 bundle 顺序必须是 `banso-dsh`、`banso-dsh-web`，不要同时加载 `banso-dsh-base` 或官方 `dsh-web-app`。
- 会话沿用 `DSH_HOME/sessions-banso-base`（默认 `~/.dsh/sessions-banso-base`）。工作区元数据和附件放在 `DSH_HOME/banso-web/`。
- `attachment-local`、`file-upload`、`commands`、文件系统及工作区存储来自官方会话接口的依赖，即使前端不显示这些功能也需要加载。
- `ui-renderer` 负责根页面渲染；`ui-session` 只提供 renderer 所需的会话作用域适配；`banso-dsh-ui` 是唯一页面。未加载官方 chat、layout、sidebar 等界面。
- 网页直接连接 Node.js DSH 服务，不经过 Python SDK；SDK 原 profile 继续使用原有组合。

## 验证

先构建，再安装测试浏览器并运行：

```sh
pnpm --filter banso-dsh-web exec playwright install chromium
pnpm --filter banso-dsh-ui test
pnpm --filter banso-dsh-web test
```

可设置 `BANSO_TEST_CHROMIUM=/absolute/path/to/chromium` 使用本机已有浏览器。测试启动真实已发布 DSH CLI，创建临时 profile/home，经 HTTP 和官方浏览器客户端调用真实默认 agent loop；模型、搜索和抓取使用本地模拟 provider，不调用在线 API。测试隔离用户 profile 和持久化目录。浏览器截图写入忽略提交的 `lib/chat-smoke.png` 和 `lib/tool-status-mobile.png`。

测试不会证明真实模型输出质量或在线搜索/阅读服务可用性。
