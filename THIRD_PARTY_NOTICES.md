# 第三方许可说明

本项目原创代码采用根目录的 [MIT 许可证](LICENSE)。以下引入或改编的第三方代码保留各自的许可，根目录许可证不替代这些条款。

## DeepSeek Harness

- 来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，`packages/bundle/sdk-minimal/cordis.patch.yml`。
- 本项目文件：`packages/base/cordis.patch.yml`，以及构建时复制到入口包的 `base.patch.yml`。
- 改动：裁剪终端和沙箱等服务、停用会话标题、调整 profile 名称与会话存储目录。
- 许可：MIT，保留 `Copyright (c) 2026 DeepSeek`；完整文本见 [packages/base/LICENSE](packages/base/LICENSE)。入口包打包时生成的 `THIRD_PARTY_NOTICES.md` 也包含该文本。

## GISA

- 来源：[RUC-NLPIR/GISA](https://github.com/RUC-NLPIR/GISA) 的 [eval_script/run_evaluation.py](https://github.com/RUC-NLPIR/GISA/blob/main/eval_script/run_evaluation.py)。
- 本项目文件：`evaluation/banso_eval/gisa_scoring.py`，经 BansoAgain 迁入的评分实现。
- 改动：将官方评分逻辑整理为独立离线模块，调整类型、输入输出接口及错误处理，接入本项目的评分结果结构。
- 许可：该评分模块采用 Apache-2.0，完整上游许可文本见 [licenses/GISA-Apache-2.0.txt](licenses/GISA-Apache-2.0.txt)。
