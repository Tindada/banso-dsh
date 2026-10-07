# Banso 提示词插件

`banso-dsh-prompt` 为默认 DSH agent loop 提供研究规则和本轮参考时间。由 `banso-dsh` bundle 加载，依赖 `systemPrompt`、`agents` 服务。

- `banso:research` section：搜索、阅读、事实核实、时间限定、来源引用及结束判断。文字在 `src/prompts.ts`。
- `banso:reference-time` context：本轮开始处理输入时的 UTC 时间。需要 `includeRuntimeContext: true`；Banso bundle 已开启。

## 配置

可在 profile patch 中完整替换研究规则；未设置 `researchPrompt` 时使用内置提示词。文本按字面使用，不展开 `{{变量}}`。显式空字符串会移除本插件的研究规则，但不影响参考时间、身份描述和其他插件的提示词。

```yaml
- id: banso-prompt
  config:
    researchPrompt: |-
      Your custom research instructions...
```

这是运行环境级配置，不是 SDK 每题参数。修改后重启运行环境。身份描述仍通过 `system-prompt` 的 `personaPrefix` 配置。

插件同步监听 `agent/inbox/claimed`，在同一 agent 的新 turn 首次领取输入时记录服务器时间。后续工具调用、step、重试和并入本轮的补充输入保持该时间；下一 turn 重新取时间。状态使用插件实例内的 WeakMap，按 agent 隔离，context 回调只读取状态，不生成时间。没有 agent 或尚未领取输入时不输出时间。

参考时间表示“现在”，不是检索范围。历史日期或指定时间范围直接写在用户消息中，不需要额外 SDK 参数。时间使用 UTC；需要其他时区口径时在问题中明确说明。

不新增 session 持久化格式。恢复会话后的下一轮会重新取时间；不保证研究过程中热重载插件能恢复旧参考时间，修改插件后应重启运行环境。旧 context 快照可能仍在历史中，框架会将新快照标为取代之前的 runtime context。

本版通过提示词引导研究，没有独立证据库、正文证据隔离、业务预算或引用语义校验。

## 验证

在 workspace 根目录运行：

```sh
pnpm typecheck
pnpm build
pnpm --filter banso-dsh-prompt test
```

测试使用真实默认 loop、模拟 LLM 和可控时钟，检查最终模型请求中的时间快照，覆盖首步、补充消息、工具调用、重试、跨轮更新、agent 隔离和插件卸载重载。测试不访问网络，不验证真实模型的研究质量。
