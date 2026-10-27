# 打包与发布

本文面向维护者，说明打包、验证和发布流程。发布状态与独立安装验证见 [迁移规划](plan.md#发布状态)，源码构建和测试见 [开发文档](development.md)。

## 版本与文档

1. 确定本次需要发布的包，核对 `package.json` 版本、依赖和变更范围。`workspace:*` 是源码依赖声明，应检查 pnpm 打包后是否转换成预期的版本。
2. 各包 README 描述该版本的用途、配置、公共接口和限制，不记录发布进度。源码构建、内部实现和测试记录放在开发文档。
3. 根 README 的固定安装版本在发布并完成独立安装验证后更新。尚需源码安装的功能应在根 README 标明安装方式。
4. 包 README 的跨包、仓库链接使用完整 GitHub URL；当前链接指向 `main`，内容会随源码演进。发布时可改用已创建并推送的版本 tag，以固定文档内容。

## 构建与检查

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

按变更范围运行开发文档中的测试。默认模拟服务测试不代表真实搜索、模型服务或 npm 安装路径已经验证。

所有包均配置了 `files`。除这些声明外，还应检查实际包中的 README、许可证和包元数据，不能仅靠 `files` 推断完整内容。

- TypeScript 包的 `prepack` 会清理并重建 `lib/`，打包会执行这些生命周期脚本。
- `banso` 的 build/prepack 从 `banso-dsh-base` 复制基础 patch，并根据其 LICENSE 生成 `THIRD_PARTY_NOTICES.md`。应维护基础包许可和生成脚本，不直接修改生成文件。
- `base` 是纯配置包；`web` 分发 `src` 和 patch；`ui` 分发构建后的客户端产物。
- 发布到 npm 时，先发布 materials，再发布依赖该版本的 Banso；本地开发使用 workspace 链接。

在仓库根目录执行以下命令，将产物保存到仓库外的临时目录，再逐包打包：

```sh
mkdir -p /tmp/banso-dsh-release
pnpm --dir packages/banso pack --pack-destination /tmp/banso-dsh-release
```

对本次发布的其他包重复执行，并检查生成 tarball 的内容：

```sh
tar -tzf /tmp/banso-dsh-release/banso-dsh-0.1.1.tgz
tar -xOf /tmp/banso-dsh-release/banso-dsh-0.1.1.tgz package/package.json
```

示例文件名来自当前源码版本，实际检查使用命令输出的文件名。检查包内 `package.json` 的版本、入口及依赖，确认没有残留的 `workspace:` 或本地链接。核对：入口和类型文件可用，生成 patch 完整，README、许可证和第三方声明齐备，没有密钥、测试截图或本地运行数据；包内相对链接能在解压目录中解析。跨仓库链接需另行检查。

## 许可文件

以 pnpm 生成的最终 tarball 为准，检查原创代码的 MIT 许可全文是否随包分发；缺失时补齐并重新打包。base 的上游 LICENSE 和入口包的 `THIRD_PARTY_NOTICES.md` 也需保留。包目录是否有 LICENSE、`files` 配置或其他包管理器的预览都不能代替最终产物检查。

## 独立安装与发布记录

先在仓库之外的临时项目、独立 `DSH_HOME` 和 profile 中验证打包产物。若依赖版本尚未发布，应同时使用本次相关 tarball，避免误用 npm 上的旧包。检查配置合成和所需的 SDK 或 Web 启动路径；真实在线试跑会消耗 API 额度。

用 DSH 的 `plugin --profile <名称> add` 创建 profile 并安装入口包。验证未发布的 tarball 时，在该 profile 的 `pnpm-workspace.yaml` 中设置 `overrides`，将所有本次 Banso 依赖指向对应 tarball；保留文件中已有配置。仅添加入口 tarball 不能保证传递依赖也来自本次产物。

安装过程中有两个独立的构建审批位置：安装 DSH 后在工作目录执行 `pnpm approve-builds`；安装入口包后执行 `pnpm exec dsh plugin --profile <名称> exec pnpm approve-builds`，批准 profile 中的 koffi 构建。检查 profile 的 `package.json` 和 `pnpm list --depth 0`，确认依赖安装完成，再设置 `dsh.profile.bundles`；设置 bundle 列表本身不会安装包。

安装、审批、配置和启动必须使用同一个 `DSH_HOME`。Python 测试脚本显式设置的 `dsh_home` 应指向该目录，不能继续引用旧验证环境。

准备发布时逐包确认 npm 身份、目标版本、registry 和 dist-tag，按依赖顺序发布。使用已完成验证的 tarball 发布；若重新打包，需重新检查产物。发布后，再从 npm 在独立目录仅安装入口包，确认依赖能够自动获取。Web/UI 只有完成自己的发布与安装验证后，才能将源码启动说明改为 npm 安装说明。

发布后的验证使用新的工作目录和 DSH home，不复制旧 profile 或 overrides，按根 README 从 npm 安装固定版本的入口包，再验证 SDK 和 Web。密钥配置可以复用，安装依赖与 profile 配置应重新创建。

记录日期、包版本、DSH/SDK 版本、安装来源、验证路径和未覆盖范围。将发布状态同步到规划和根 README；测试数量只作为有日期或阶段背景的历史记录，不作为长期有效的当前状态。
