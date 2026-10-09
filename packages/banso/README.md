# Banso 业务 bundle

`banso-dsh` 组合精简 SDK 基础环境、Tavily 搜索、Jina Reader 抓取 和 [Banso 提示词插件](../prompt/README.md)，向 agent 提供 `web_search`、`web_read`、研究规则和每轮固定的 UTC 参考时间。业务 profile 只加载本包；基础配置已包含在内，不要再同时加载 `banso-dsh-base`。

本包在配置中直接将 persona 设为新闻研究助手，并开启 runtime context。参考时间自动取自服务器；指定历史日期或研究范围直接写在用户消息中。基础包配置不变。

本包由 Banso 项目独立维护，非 DeepSeek 官方发行包。随包分发的 `base.patch.yml` 改编自 DSH 的 `sdk-minimal` 配置，遵循 MIT；构建和打包时同步生成的 `THIRD_PARTY_NOTICES.md` 保留其完整上游许可声明。

同时加载 [会话资料插件](../materials/README.md)，从现有网页工具日志维护可恢复的资料集合。资料通过每步更新的快照进入模型上下文，旧快照被简短占位替代，`web_read` 使用单个 `target` 接受资料 handle 或完整 URL，并要求 `focus` 指定提取目标。另加载 [网页工具](../tool-web/README.md)，search／read 向模型返回简短回执；read 按 focus 提取证据，全文只保存供后续复用，快照展示证据。组合关闭原生 fetch 工具，并加载 DSH 工具超时策略。

## 安装与构建

使用 Node.js 24 和 pnpm 12.8.1，在仓库根目录执行：

```sh
pnpm install
pnpm typecheck
pnpm build
```

构建会编译 Tavily、Jina、提示词、网页工具和资料插件，并将基础包的配置复制为 `base.patch.yml`。该文件不提交 Git；基础配置或插件源码变更后需重新构建。锁文件已同步时，可用 `pnpm install --frozen-lockfile` 安装。

## 创建与运行 profile

在 DSH 源码仓库目录执行，替换绝对路径。以下命令用于专用的 `banso-dsh` profile：

```sh
pnpm dsh plugin --profile banso-dsh add 'link:/absolute/path/to/banso-dsh/packages/banso'
pnpm dsh plugin --profile banso-dsh exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh"]'
pnpm dsh --profile banso-dsh --dump-config
pnpm dsh --profile banso-dsh
```

运行环境需提供 `DEEPSEEK_API_KEY` 和 `TAVILY_API_KEY`。搜索配置见 [Tavily provider](../web-search-tavily/README.md)。抓取默认使用 [Jina Reader](../web-fetch-jina/README.md)，可选提供 `JINA_API_KEY`，未提供时匿名调用。原生 HTTP provider 仍保留，将 web 插件的 `fetchProvider` 设为 `http` 可切回。

启动后提供 SDK stdio JSON-RPC 服务，没有聊天界面。Python SDK 客户端选择 `banso-dsh`；若由客户端启动 DSH，无需提前启动服务。

会话沿用基础包的 `sessions-banso-base` 目录，诊断标签仍为 `banso-base`。修改 patch 后需重启；修改基础 patch 时还需重新构建。

当前能力、验证进度和下一步见 [迁移规划](../../docs/plan.md)。

## 组合层测试

在仓库根目录先运行 `pnpm build`，再运行：

```sh
pnpm --filter banso-dsh test
```

`tests/research.test.mjs` 手动加载真实插件，使用模拟模型和网页 provider、默认 loop 与 JSONL 后端，验证工具输出、资料快照、handle 寻址、并发读取、恢复后以新 focus 复用正文并追加证据及参考时间共存。

另使用真实 Jina provider 与本地 HTTP 模拟服务，验证 handle 抓取、Markdown 正文交给提取器，以及主模型快照仅展示证据。

测试不经过 bundle 配置和 SDK 启动入口，不调用在线服务；通过这些测试不代表真实服务端请求或研究质量已经验证。功能包各自维护投影、展示和生命周期测试。
