# 会话资料与上下文快照

`banso-dsh-materials` 注册 host-only 的 `bansoMaterials` projection，依赖 `sessionProjections` 和 `agents`。从 `web_search`、`web_fetch` 的既有事件归纳资料，配合 `banso-dsh-tool-web` 的输出协议使用。不写入自定义事件；在每步进入模型请求前呈现最新资料快照。

## 读取与结构

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

导出 `Material`、`MaterialsState`、`FetchedContent` 和 `FetchAttempt` 类型。返回状态由框架持有，调用方不得修改。

- `items` 按 handle 存放资料；`urlIndex` 按精确 URL 查找 handle；`nextHandle` 保证首次有效发现按日志顺序编号。
- 资料包含 `handle`、原 URL 和可选的 `title`、`snippet`、`publishedAt`。
- `fetched` 从 fetch metadata 的必需 `content` 字段保存最后一次成功获取的文本，并保存最终 URL、状态码、截断标记和事件时间。文本包括工具页头与提示，不是原始 HTML 或独立提取的正文。
- `lastFetch` 表示最近一次抓取尝试，失败时记录错误但不清除 `fetched`。`time` 均为日志事件的 Unix 毫秒时间。
- `pendingCalls` 是按调用事件 seq 关联结果所需的内部状态，结果处理后删除，turn 结束时清理残留。

## 更新规则

- 搜索更新：按 URL 精确去重，复用 handle，仅覆盖本次提供的字段，保留已有抓取内容。
- 抓取成功：按 metadata 的 `requestUrl` 更新或创建资料，`url` 保存最终地址，重定向不合并条目。metadata 校验通过且 HTTP 为 2xx 时保存 `content`，不从短回执提取正文。
- 抓取失败：非 2xx 按 `requestUrl` 更新失败状态；工具执行错误时，按调用记录中的原始 `target` 处理——合法 URL 更新或创建条目，已有 handle 更新对应条目，未知或无效目标不创建资料。失败均保留此前成功正文。

结果须通过 `sourceEventSeqs` 关联已识别调用并匹配 callId、turn。无关工具、无法关联或 metadata 格式不符的结果不导入，不从展示文本猜测字段。仅原始追加的工具结果参与资料更新，surface 替换不覆盖资料；因此资料保留的是曾经获得的内容，而非当前 surface 的镜像。

资料跨 turn 保留，不推断任务边界。handle 在单个 session 内稳定，重放同一日志得到相同编号；不同 session 的 S1 没有关联。

## 恢复与兼容边界

投影状态由内存承载，来源是持久化的既有工具事件。JSONL 恢复、插件后加载和重载均可重建；未新增 session 格式或事件类型，投影版本保持 1。当前仍在首版开发，不保留旧 fetch 参数／metadata 的兼容分支，不做状态迁移。不另配投影检查点缓存。

这是从工具事实累计派生的索引，与 DSH 推荐的整份业务状态事件模式不同。纯同步 fold 不访问网络、不读取时钟；JSONL 恢复测试验证了这一用法。

结构化 meta 基于当前 DSH `0.2.0-rc.2` 网页工具协议，fetch 由本项目包装提供必需的 `requestUrl` 和 `content` 字段，升级时需重新验证。只支持直接的原生网页工具调用，不保证同名第三方工具或嵌套复合传输兼容。fetch 文本可能已截断，无法恢复未保存的网页内容。

本版 handle 可用于 `web_fetch` 的单个 `target` 参数；尚未接入最终引用解析，没有证据提取和长期资料库。

## 模型上下文

`agent/pre-step` 中间件等待后续决策；允许进入 step 时，将资料组织成快照，追加到 `decision.messages` 末尾，由默认 loop 提交。资料按 handle 数字排序，保留搜索字段、抓取状态、UTC 时间与全部已保存正文。新增标签和说明用英文，外部资料保持原文。最近抓取失败时，明确标记仍保留的是此前成功内容。

已有成功抓取内容的条目不再展示搜索 snippet（即使正文已截断或最近一次重抓失败）；尚无成功抓取内容时仍展示 snippet。底层资料保留 snippet，仅调整快照展示。

没有资料时不插入，内容不变时不重复追加或移动；资料变化时，通过标准 `user/message` 替换旧快照为简短占位，再追加最新快照。工具调用和短回执保持原状；参考时间仍独立使用 prompt 插件的 runtime context。

消息 source 为 `{ kind: 'banso-materials', form: 'snapshot' | 'placeholder' }`。另注册 host-only `bansoMaterialsSnapshot` 投影，仅保存最新快照的 `{ messageId, seq }` 或 `null`，不复制正文。使用时结合当前 surface 和派生消息确认快照仍有效；若被其他操作覆盖，下步重新插入。定位记录同样支持 JSONL 重放、后加载和卸载重载。

JSONL 保存旧完整快照及替换记录；模型当前可见 surface 保留一份最新完整快照和旧占位。卸载插件停止后续更新，不撤销已经写入的消息。正文、占位及历史日志均可能随会话增长，暂不提供摘要、筛选、二次裁剪或总量控制。

## 验证

```sh
pnpm --filter banso-dsh-materials test
```

本包测试只验证资料投影和上下文快照：使用模拟工具事件验证更新、失败、调用关联、隔离和确定性重放；配合真实默认 loop 和模拟模型验证快照替换、重试、拒绝进入 step、外部覆盖及插件重载。测试不加载网页工具或网页 provider。

跨包链路及 JSONL 恢复验证见 [Banso 组合层测试](../banso/README.md#组合层测试)。
