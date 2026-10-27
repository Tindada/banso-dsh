# Banso 提示词插件

`banso-dsh-prompt` 为默认 DSH agent loop 提供可配置的研究规则和本轮参考时间。由 Banso SDK bundle 或 preset 加载，依赖 `systemPrompt`、`agents` 服务。

- `banso:research` section：通过 `researchPrompt` 配置研究规则，当前默认正文为空；工具操作协议及材料指导由 [资料插件](https://github.com/Tindada/banso-dsh/blob/main/packages/materials/README.md) 提供。
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

每个 agent 的新 turn 首次领取输入时记录服务器时间。后续工具调用、step、重试和并入本轮的补充输入保持该时间；下一 turn 重新取时间。没有 agent 或尚未领取输入时不输出时间。

参考时间表示“现在”，不是检索范围。历史日期或指定时间范围直接写在用户消息中，不需要额外 SDK 参数。时间使用 UTC；需要其他时区口径时在问题中明确说明。

不新增 session 持久化格式。恢复会话后的下一轮会重新取时间；不保证研究过程中热重载插件能恢复旧参考时间，修改插件后应重启运行环境。旧 context 快照可能仍在历史中，框架会将新快照标为取代之前的 runtime context。

本包通过提示词引导研究，不负责材料存储、证据提取、业务预算或引用语义校验；材料和证据行为由资料插件提供。

源码实现和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。
