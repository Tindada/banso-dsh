# Banso 聊天 UI

`banso-dsh-ui` 是 DSH 浏览器插件。宿主入口无业务行为；客户端向官方 renderer 的 `root` 插槽注册 Banso 页面，配合 `banso-dsh-web` 使用。

使用官方 `sessions.create/retain` 和 session 的 `beginSubmission/prompt/cancel`，订阅 session snapshot 和 event source。当前会话 ID 只保留在页面内存；不会写入 URL 或 localStorage。文本交给 React 转义，不解析 HTML 或 Markdown。

`messages.ts` 只投影用户文字、assistant 正文和实时正文，不显示推理、工具结果或注入上下文。临时流到持久事件的替换由官方会话对象层负责。卸载时释放会话引用、样式及根插槽注册。

构建使用 TypeScript 和 esbuild，生成 DSH `__ModuleLoader__.load` 工厂；React 使用宿主共享模块，不捆绑第二份 React。不依赖 DSH 源码仓库的构建脚本。

```sh
pnpm --filter banso-dsh-ui build
pnpm --filter banso-dsh-ui typecheck
pnpm --filter banso-dsh-ui test
```

运行和集成测试见 [Web 说明](../web/README.md)。
