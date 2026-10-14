# 会话资料与证据快照

`banso-dsh-materials` 从 `web_search`、`web_read`、`materials_hide` 的工具事件维护 host-only `bansoMaterials` 投影，依赖 `sessionProjections`、`agents` 和 `tools`，并注册 `materials_hide` 工具。配合 [网页工具](../tool-web/README.md) 的 metadata 协议使用，不调用 LLM、不导入 tool-web、不新增事件类型。

## 状态与更新

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

返回状态由框架持有，调用方不得修改。导出 `Material`、`MaterialsState`、`FetchedContent` 和 `Evidence` 类型。

- `items` 按 handle 保存资料，`urlIndex` 按精确请求 URL 索引；首次有效发现按日志顺序分配 `S1`、`S2`。重定向的最终 URL 不合并其他条目。
- `hidden` 缺省或为 `false` 时可见，为 `true` 时隐藏整个条目。再次搜索命中同一精确请求 URL 或收到有效阅读结果时设为 `false`；正文、证据及 handle 均保留。
- 资料保留标题、snippet、发布时间等搜索字段。搜索仅覆盖本次提供的字段，不清除正文或证据。
- `fetched` 保存最后成功的格式化正文、最终 URL、截断标记及正文入库时间。失败保留此前正文。
- `evidence` 为追加的证据组，每组保存 `focus`、`text` 和提取结果入库时间 `time`。失败和空结果不清除已有证据。
- 正文复用不更改入库时间，也不重复记录全文。正文和证据的时间均取自各自入库的结果事件，单位为 Unix 毫秒。

`pendingCalls` 仅保存工具名称与调用身份，通过事件 seq、callId、turn 关联结果；参数校验和目标解析由工具负责。仅原始追加且 metadata 有效的结果更新资料，处理后删除 pending，turn 结束清理残留。不会从短回执猜测正文或证据。操作成功、失败或无相关证据的状态保留在工具回执中，资料快照不重复展示。

抓取阶段失败可按请求 URL 创建条目。普通工具错误包含非法输入和整体取消，未提交有效 metadata 时不更新资料。提取失败的结果仍可保存本次成功正文。

## 批量隐藏工具

```ts
materials_hide({ handles: ["S3", "S7"] })
```

`handles` 为必填的非空字符串数组，重复值去重。结果为 `{ hidden: string[], alreadyHidden: string[], unknown: string[] }`：分别表示本次隐藏、已经隐藏和不存在的 handle。未知 handle 不阻止处理其他条目；重复隐藏没有额外副作用。工具默认独占调度，不调用网络或 LLM。

工具只读取当前会话状态并返回结果，由正常提交的 `tool/result` metadata 驱动投影设置 `hidden: true`，下一份快照生效；不会直接修改投影或消息。缺少 agent、材料投影、空数组以及取消按工具错误处理，不提交隐藏操作。

不提供独立恢复工具。再次搜索到同一 URL 或通过 handle／URL 阅读会自动重新展示材料。阅读正常返回有效 metadata 时，即使抓取或提取失败也重新展示已有材料；非法输入、未知 handle 和整体取消不改变可见性。

## 模型上下文

`renderMaterials()` 仅展示 `hidden !== true` 的条目，包括来源、已保存正文的信息、截断标记，以及各 focus 的证据文本。全文只保存在资料状态，不自动进入主模型上下文。没有有效证据时展示搜索 snippet，有证据后隐藏；底层始终保留 snippet。证据只覆盖所记录的 focus，追问可再次读取同一来源。

`agent/pre-step` 在允许进入 step 时将最新快照加入消息。资料按 handle 数字排序；内容不变时复用快照，发生变化时用短占位替换旧快照，再追加新快照。已有材料全部隐藏时生成“当前没有可见材料”的空快照并替换旧快照；从未收集材料时不插入快照。消息 source 为 `{ kind: 'banso-materials', form: 'snapshot' | 'placeholder' }`。

`bansoMaterialsSnapshot` 投影只保存最新快照的 `{ messageId, seq }` 或 `null`。快照被外部操作覆盖时，下步重新插入。卸载停止后续更新，不撤销已写入消息。

## 恢复与边界

资料跨 turn 保存，handle 仅在当前 session 内有效。纯同步投影不访问网络或读取时钟，支持 JSONL 重放、后加载和卸载重载。`stateVersion` 保持 `1`，不做旧版本兼容或历史迁移，不增加额外检查点缓存。

正文可能已被 provider 截断，无法恢复未保存内容。证据和历史日志仍会增长，本版不实现证据合并、总量控制、长期资料库或最终引用语义校验。

```sh
pnpm --filter banso-dsh-materials test
```

投影测试使用事件夹具；工具和上下文测试使用真实 tools 服务、默认 loop 与模拟模型，不加载网页工具或网页 provider。覆盖更新、失败、关联、隔离、确定性重放、快照替换、拒绝进入 step 及重载，以及批量隐藏的分类去重、输入校验、只读执行和数据保留。搜索及阅读结果重新展示材料，包含正常返回 metadata 的抓取／提取失败；全部隐藏后用空快照替换旧快照，恢复后重新展示。

完整读取链路与 JSONL 恢复见 [Banso 组合层测试](../banso/README.md#组合层测试)。测试不验证真实模型自主隐藏材料的效果。
