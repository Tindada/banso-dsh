# Banso preset

`banso-dsh-preset` 向现有官方 DSH Web profile 增加 `banso` preset，声明 DSH 兼容范围 `>=0.2.1-rc.2 <0.3.0-0`，开发与实际验证基线为 `0.2.1-rc.2`，其他版本尚未验证。它只组合已有插件，不包含独立应用、base 或 Web；宿主提供模型、默认 loop、会话存储和工具超时策略。

## 从源码加载

在 Banso 仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm run dsh plugin --profile web add "link:$PWD/packages/preset"
pnpm dev
```

以上命令使用仓库内 `.dsh`。加载到已有外部 profile 时，改用 `pnpm exec dsh plugin --profile <名称> add "link:$PWD/packages/preset"` 和 `pnpm exec dsh --profile <名称>`，安装和启动保持同一个 `DSH_HOME`。安装会追加本 bundle，保留已有 presets 和默认选择。重启后，在新任务中选择 **Banso**；已开始的任务不能切换 preset。

不需要加载 `banso-dsh` 完整组合，也不要额外启用 materials 独立 bundle。

## 从 npm 加载

在已有 DSH 环境中执行：

```sh
dsh plugin --profile web add banso-dsh-preset@0.1.0
dsh --profile web
```

只安装 preset 即可，其依赖会自动获取；新任务中选择 **Banso**。安装和启动使用同一 `DSH_HOME`。

## 行为与配置

- 使用 Banso 研究身份、`banso-dsh-prompt` 和每轮 UTC 参考时间。当前 prompt 插件默认研究规则正文为空；可通过 `researchPrompt` 配置补充规则。materials 自带材料使用与来源引用指导。
- `web_search` 默认使用 DeepSeek Search API，超时预算 60 秒；`web_read` 使用 Jina 获取正文，支持 direct/extract、正文复用及材料隐藏。每轮搜索与阅读共享默认 15 次尝试预算。
- 模型使用宿主的会话模型配置。搜索沿用官方 DeepSeek API provider 的认证方式，默认凭据名 `DEEPSEEK_API_KEY`；Jina 读取启动环境的 `JINA_API_KEY`，可为空。模型可用并不意味着搜索凭据已配置。
- provider 与研究工具共享 preset 内的独立 `web` 服务，不修改宿主 Web Search 设置。官方进程环境变量 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` 仍会影响该服务，使用默认组合时应保持未设置。

本包不限制宿主工具。在默认官方 Web 中，Banso 的三个研究工具之外还会继承 `working_directory`；其他 preset 的终端和文件编辑工具不会因此加入 Banso。用户额外注册的宿主全局工具也可能被继承，preset 不是安全沙箱。

配置入口为 `preset-banso.config.plugins`。persona、研究提示词及 `research-web` 组均在该列表中；web 服务、provider、搜索工具和 materials 必须保持在同一个隔离组内。profile patch 覆盖 `plugins` 时按完整列表替换，不按内部 id 自动合并；修改后重启 DSH。

会话和资料使用宿主原有存储，按会话隔离；不自动迁移旧 Banso Web/SDK 会话。官方页面沿用现有工具展示，没有新增材料面板；附件等扩展功能未验收。

## 验证

完成根目录构建后，执行 `pnpm --filter banso-dsh-preset test`。集成测试检查配置合成、真实 preset loader 和默认 loop、研究流程、工具列表、其他 preset 共存及打包产物，使用模拟模型/provider，不验证在线 Search/Jina 可用性。

2026-10-27 本机验证通过：workspace 类型检查与构建、上述集成测试及 materials/Banso 回归；临时官方 Web 中完成选择 Banso、研究工具详情、追问、流式输出、停止、刷新恢复及恢复后继续追问。页面验收使用模拟服务，未调用在线 Search/Jina。
