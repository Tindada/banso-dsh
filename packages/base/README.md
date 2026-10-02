# Banso 基础 SDK bundle

`banso-dsh-base` 源自 try-minimal 实验，以 17 个插件提供默认 `ReactLoopAgent`、DeepSeek 模型调用、SDK 入口、会话持久化、重试及运行时检查。保留工具注册服务，但没有具体工具或 Web UI。纯配置包，无需编译。

业务使用见 [Banso bundle](../banso/README.md)；以下步骤用于单独验证基础环境。

## 独立运行

在本仓库根目录执行 `pnpm install`。然后在 DSH 源码仓库目录执行，替换绝对路径：

```sh
pnpm dsh plugin --profile banso-base add 'link:/absolute/path/to/banso-dsh/packages/base'
pnpm dsh plugin --profile banso-base exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh-base"]'
pnpm dsh --profile banso-base --dump-config
pnpm dsh --profile banso-base
```

这些命令用于专用的 `banso-base` profile。运行环境需要 `DEEPSEEK_API_KEY`，可用 `DSH_SYSTEM_PROMPT` 覆盖默认提示词。

服务通过 SDK stdio JSON-RPC 接收请求，由客户端创建 agent。Python SDK 选择 `banso-base`；若由客户端启动 DSH，无需提前启动服务。会话默认保存在 `~/.dsh/sessions-banso-base`，设置 `DSH_HOME` 可改变 home 位置。

基础配置只维护本包的 `cordis.patch.yml`。业务包构建时会复制它；更改后需重新构建业务包并重启。

配置检查与用户的 Python SDK 调用已通过，详细验证范围见 [迁移规划](../../docs/plan.md)。
