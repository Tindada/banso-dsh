# 网页工具输出包装

`banso-dsh-tool-web` 依赖 `tools` 和 `agents`，在 agent scope 中包装原生 `web_search`、`web_fetch` 的输出定义。需要同时加载 `@deepseek-ai/dsh-tool-web`；不复制它的源码，不改变全局定义、工具参数、执行逻辑、输出 schema、超时配置或 provider。

## 输出

- search：content 返回来源数量、截断状态和可选 answer；不重复来源列表与摘要。metadata 沿用原生 sources、truncated、answer。
- fetch：content 返回成功／非 2xx 失败、HTTP 状态和有效截断标记。metadata 保留原有 url、statusCode、truncated，并增加必需的 `content: string`，保存原工具渲染出的文本。
- fetch 的 metadata 文本复用原工具导出的 `formatFetchOutput(result, Infinity)`，保留格式化、HTML 转换与页头，不再应用工具层的长度截断；回执与 metadata 使用相同的截断状态。provider 的大小限制仍然有效，已截断的内容无法恢复，保存的文本也不是原始 HTML。执行异常和取消沿用框架的错误结果。

`banso-dsh-materials` 只从 fetch 的 `meta.content` 读取成功正文，不从简短回执读取。材料 context 尚未接入；本插件只负责工具输出协议。

## 生命周期

通过 `agent/created` 安装新建和恢复 agent，通过已有 agent 列表支持后加载。监听 `tools/change` 处理原生工具的晚加载、卸载和重载；包装定义按原定义引用缓存。

重新检查可见性时，先撤销自己的 scope 注册，避免局部包装掩盖新应用的工具限制，再为仍可见的原生全局定义注册包装。同名的其他局部定义保持原样。刷新期间忽略自身产生的工具变更通知；agent 销毁及插件卸载会清理覆盖。

支持当前 DSH `0.2.0-rc.2` 原生网页工具和 Banso 的 native 调用组合，不保证同名第三方工具或复合工具传输兼容。

## 验证

```sh
pnpm --filter banso-dsh-tool-web test
pnpm --filter banso-dsh-materials test
```

使用模拟 provider 验证原执行复用、简短 content、完整 metadata、格式化与截断、失败、局部覆盖、可见性限制及加载／卸载。资料插件的集成测试使用真实默认 loop 和 JSONL 后端验证新协议的保存、恢复及继续调用。测试不访问在线模型或搜索服务。
