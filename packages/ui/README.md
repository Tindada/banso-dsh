# Banso 聊天 UI

`banso-dsh-ui` 是 DSH 浏览器插件，配合 `banso-dsh-web` 使用，向官方 renderer 的 `root` 插槽注册 Banso 页面。

## 集成要求

接口对齐 DSH `0.2.0-rc.2`；需要官方 `@deepseek-ai/dsh-api-session-controller` 和 `@deepseek-ai/dsh-client-ui-renderer` 客户端服务，由 Web bundle 配置依赖。宿主入口不提供独立业务服务，无需单独启动 UI。不要同时加载其他占用根页面的聊天 UI。

## 展示与限制

支持单会话文字聊天、连续追问、流式回答、停止和错误提示。不显示推理或注入上下文，不提供资料面板。

执行期间分别显示每次搜索、阅读的进行中、完成、失败或取消状态；可展开查看关键词、关注点、URL 和错误详情，并保留本轮先前的失败记录。仅展示整次调用，不区分下载与提取阶段。本轮完成、失败或停止后隐藏全部工具记录，服务端日志仍保留。

伴随工具调用的模型文字临时显示，当前步骤结束后消失；普通回答保留。

当前会话 ID 仅保留在页面内存中，没有历史列表和刷新恢复；刷新后下一次发送会创建新会话。刷新或关闭页面不保证停止服务端任务。文本由 React 转义，不解析 HTML 或 Markdown。

安装和启动见 [Web 聊天使用说明](https://github.com/Tindada/banso-dsh/blob/main/README.md#web-聊天源码安装)。运行配置和存储说明见 [Web bundle](https://github.com/Tindada/banso-dsh/blob/main/packages/web/README.md)。源码构建、消息投影和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。
