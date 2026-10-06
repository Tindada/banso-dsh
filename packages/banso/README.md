# Banso 业务 bundle

`banso-dsh` 组合精简 SDK 基础环境、Tavily 搜索、HTTP Fetch 和 [Banso 提示词插件](../prompt/README.md)，向 agent 提供 `web_search`、`web_fetch`、研究规则和每轮固定的 UTC 参考时间。业务 profile 只加载本包；基础配置已包含在内，不要再同时加载 `banso-dsh-base`。

本包在配置中直接将 persona 设为新闻研究助手，并开启 runtime context。参考时间自动取自服务器；指定历史日期或研究范围直接写在用户消息中。基础包配置不变。

同时加载 [会话资料插件](../materials/README.md)，从现有网页工具日志维护可恢复的资料集合。资料通过每步更新的快照进入模型上下文，旧快照被简短占位替代，`web_fetch` 使用单个 `target` 接受资料 handle 或完整 URL。另加载 [网页工具输出包装](../tool-web/README.md)，search／fetch 向模型返回简短回执，fetch 正文保存到 metadata 供资料投影读取。

## 安装与构建

使用 Node.js 24 和 pnpm 12.8.1，在仓库根目录执行：

```sh
pnpm install
pnpm typecheck
pnpm build
```

构建会编译 Tavily、提示词、网页工具输出包装和资料插件，并将基础包的配置复制为 `base.patch.yml`。该文件不提交 Git；基础配置或插件源码变更后需重新构建。锁文件已同步时，可用 `pnpm install --frozen-lockfile` 安装。

## 创建与运行 profile

在 DSH 源码仓库目录执行，替换绝对路径。以下命令用于专用的 `banso-dsh` profile：

```sh
pnpm dsh plugin --profile banso-dsh add 'link:/absolute/path/to/banso-dsh/packages/banso'
pnpm dsh plugin --profile banso-dsh exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh"]'
pnpm dsh --profile banso-dsh --dump-config
pnpm dsh --profile banso-dsh
```

运行环境需提供 `DEEPSEEK_API_KEY` 和 `TAVILY_API_KEY`。搜索配置见 [Tavily provider](../web-search-tavily/README.md)。

启动后提供 SDK stdio JSON-RPC 服务，没有聊天界面。Python SDK 客户端选择 `banso-dsh`；若由客户端启动 DSH，无需提前启动服务。

会话沿用基础包的 `sessions-banso-base` 目录，诊断标签仍为 `banso-base`。修改 patch 后需重启；修改基础 patch 时还需重新构建。

当前能力、验证进度和下一步见 [迁移规划](../../docs/plan.md)。

## 组合层测试

在仓库根目录先运行 `pnpm build`，再运行：

```sh
pnpm --filter banso-dsh test
```

`tests/research.test.mjs` 手动加载真实插件，使用模拟模型和网页 provider、默认 loop 与 JSONL 后端，验证工具输出、资料快照、handle 寻址、并发抓取、恢复后继续调用及参考时间共存。

测试不经过 bundle 配置和 SDK 启动入口，不调用在线服务；通过这些测试不代表真实服务端请求或研究质量已经验证。功能包各自维护投影、展示和生命周期测试。
