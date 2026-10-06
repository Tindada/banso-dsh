# 会话资料与证据快照

`banso-dsh-materials` 从 `web_search`、`web_read` 的工具事件维护 host-only `bansoMaterials` 投影，依赖 `sessionProjections` 和 `agents`。配合 [网页工具](../tool-web/README.md) 的 metadata 协议使用，不调用 LLM、不导入 tool-web、不新增事件类型。

## 状态与更新

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

返回状态由框架持有，调用方不得修改。导出 `Material`、`MaterialsState`、`FetchedContent` 和 `Evidence` 类型。

- `items` 按 handle 保存资料，`urlIndex` 按精确请求 URL 索引；首次有效发现按日志顺序分配 `S1`、`S2`。重定向的最终 URL 不合并其他条目。
- 资料保留标题、snippet、发布时间等搜索字段。搜索仅覆盖本次提供的字段，不清除正文或证据。
- `fetched` 保存最后成功的格式化正文、最终 URL、截断标记及正文入库时间。失败保留此前正文。
- `evidence` 为追加的证据组，每组保存 `focus`、`text` 和提取结果入库时间 `time`。失败和空结果不清除已有证据。
- 正文复用不更改入库时间，也不重复记录全文。正文和证据的时间均取自各自入库的结果事件，单位为 Unix 毫秒。

`pendingCalls` 仅保存工具名称与调用身份，通过事件 seq、callId、turn 关联结果；参数校验和目标解析由工具负责。仅原始追加且 metadata 有效的结果更新资料，处理后删除 pending，turn 结束清理残留。不会从短回执猜测正文或证据。操作成功、失败或无相关证据的状态保留在工具回执中，资料快照不重复展示。

抓取阶段失败可按请求 URL 创建条目。普通工具错误包含非法输入和整体取消，未提交有效 metadata 时不更新资料。提取失败的结果仍可保存本次成功正文。

## 模型上下文

`renderMaterials()` 展示来源、已保存正文的信息、截断标记，以及各 focus 的证据文本。全文只保存在资料状态，不自动进入主模型上下文。没有有效证据时展示搜索 snippet，有证据后隐藏；底层始终保留 snippet。证据只覆盖所记录的 focus，追问可再次读取同一来源。

`agent/pre-step` 在允许进入 step 时将最新快照加入消息。资料按 handle 数字排序；内容不变时复用快照，发生变化时用短占位替换旧快照，再追加新快照。消息 source 为 `{ kind: 'banso-materials', form: 'snapshot' | 'placeholder' }`。

`bansoMaterialsSnapshot` 投影只保存最新快照的 `{ messageId, seq }` 或 `null`。快照被外部操作覆盖时，下步重新插入。卸载停止后续更新，不撤销已写入消息。

## 恢复与边界

资料跨 turn 保存，handle 仅在当前 session 内有效。纯同步投影不访问网络或读取时钟，支持 JSONL 重放、后加载和卸载重载。状态版本保持 `1`；首版直接替换旧 fetch 协议，不做兼容、历史迁移或额外检查点缓存。

正文可能已被 provider 截断，无法恢复未保存内容。证据和历史日志仍会增长，本版不实现证据合并、总量控制、长期资料库或最终引用语义校验。

```sh
pnpm --filter banso-dsh-materials test
```

投影测试只使用事件夹具；上下文测试使用真实默认 loop、模拟模型和工具事件，覆盖更新、失败、关联、隔离、确定性重放、快照替换、拒绝进入 step 及重载，不加载网页工具或网页 provider。完整读取链路与 JSONL 恢复见 [Banso 组合层测试](../banso/README.md#组合层测试)。
