# 原生 DSH Web 工具基线（`banso-dsh-web-baseline`）

用于 GISA 对照测评的私有本地 bundle。基于 `banso-dsh-base` 挂载原生 `@deepseek-ai/dsh-tool-web`（同时开启 `web_search` 与 `web_fetch`）和 DeepSeek Search/Fetch API，不依赖 `banso-dsh`、`banso-dsh-materials` 或 `banso-dsh-prompt`。

## 安装与检查

在仓库根目录完成 `pnpm install` 与 `pnpm build` 后，将本包链接到 `.dsh` 下的 `dsh-web-baseline` profile：

```sh
pnpm run dsh plugin --profile dsh-web-baseline add "link:$PWD/packages/web-baseline"
pnpm run dsh plugin --profile dsh-web-baseline exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh-web-baseline"]'
pnpm run dsh --profile dsh-web-baseline --dump-config
```

## 运行 GISA 对照测评

在 `evaluation/.env` 中将 `EVAL_DSH_PROFILE` 设为 `dsh-web-baseline`（确保 `EVAL_DSH_HOME` 指向已安装该 profile 的目录），再按 `evaluation/README.md` 运行 `banso_eval.batch` 和 `banso_eval.score`。
