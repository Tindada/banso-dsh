# 网页工具输出包装

`banso-dsh-tool-web` 依赖 `tools`、`agents` 和 `sessionProjections`，在 agent scope 中包装原生 `web_search`、`web_fetch`。需要同时加载 `@deepseek-ai/dsh-tool-web`；不复制它的源码，保持全局定义、超时配置和 provider 不变。search 仅调整输出；fetch 增加单条 handle 寻址并复用原生执行。

## fetch 参数

`web_fetch` 每次接受一个 `target`，可传当前 session 的资料 handle 或完整 HTTP(S) URL：

```json
{"target": "S1"}
```

```json
{"target": "https://example.com/article"}
```

多个页面使用多个独立工具调用，沿用 DSH 默认 loop 的并发调度。handle 只在执行侧从 `bansoMaterials` 投影读取 URL；直接 URL 不要求预先存在资料。未知 handle、资料查询失败及非法参数沿用普通工具错误。

执行不分配编号。新 URL 在结果入库时由资料投影分配 handle，下一步快照显示编号。本版不保留旧的单 `url` 参数，不做历史协议兼容或迁移。

## 输出

- search：content 返回来源数量、截断状态和可选 answer；不重复来源列表与摘要。metadata 沿用原生 sources、truncated、answer。
- fetch：content 返回输入目标、请求 URL、成功／非 2xx 失败、HTTP 状态和有效截断标记。metadata 为 `{ requestUrl, url, statusCode, truncated, content }`；`requestUrl` 为原请求地址，`url` 为最终地址，`content` 保存原工具渲染出的文本。`execute` 返回值及其 output schema 在原生结构上增加 `requestUrl`。
- fetch 的 metadata 文本复用原工具导出的 `formatFetchOutput(result, Infinity)`，保留格式化、HTML 转换与页头，不再应用工具层的长度截断；回执与 metadata 使用相同的截断状态。provider 的大小限制仍然有效，已截断的内容无法恢复，保存的文本也不是原始 HTML。执行异常和取消沿用框架的错误结果。

`banso-dsh-materials` 只从 fetch 的 `meta.content` 读取成功正文，不从简短回执读取。资料快照负责向模型呈现正文。本包仅通过 `import type` 引入 materials 的类型声明，直接读取有类型的资料投影，不在运行时导入 materials。

## 生命周期

通过 `agent/created` 安装新建和恢复 agent，通过已有 agent 列表支持后加载。监听 `tools/change` 处理原生工具的晚加载、卸载和重载；包装定义按原定义引用缓存。

重新检查可见性时，先撤销自己的 scope 注册，避免局部包装掩盖新应用的工具限制，再为仍可见的原生全局定义注册包装。同名的其他局部定义保持原样。刷新期间忽略自身产生的工具变更通知；agent 销毁及插件卸载会清理覆盖。

支持当前 DSH `0.2.0-rc.2` 原生网页工具和 Banso 的 native 调用组合，不保证同名第三方工具或复合工具传输兼容。

## 验证

```sh
pnpm --filter banso-dsh-tool-web test
```

使用模拟 provider 验证原执行复用、单条 target 校验、取消、简短 content、完整 metadata、格式化与截断、失败、局部覆盖、可见性限制及加载／卸载。测试不访问在线模型或搜索服务。跨包验证见 [Banso 组合层测试](../banso/README.md#组合层测试)。
