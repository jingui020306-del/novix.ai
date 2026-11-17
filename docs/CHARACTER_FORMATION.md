# 人物性格来由

在人物卡打开「补写性格来由」，写下一条观察，或直接使用已填资料。勾选空项后可比较候选、修改文字，只采用其中几项，再保存人物。应对方式可以填写适用处境。场景与处境匹配时，自动排演可以采用这一行动，已安排的行动优先。人物细节的用途和适用时期可在原人物卡继续调整。双人场景请求 AI 推演后，可以选择「按候选动机做双人排演」，让本地引擎比较这些行动。

默认由启动器的本地 Qwen3-1.7B 生成中文候选。生成时借用 TESSERA 的情境、预期、应对和反馈来组织人物经历。[TESSERA 原文](https://pubmed.ncbi.nlm.nih.gov/27260302/)

## 可选的本地专用模型

在运行 Novix 的环境中安装依赖。例如在 CPU 环境运行以下命令。

```sh
conda activate novix
python -m pip install "torch>=2.6,<3" --index-url https://download.pytorch.org/whl/cpu
python -m pip install "transformers>=4.48,<5" sentencepiece
```

| 模型 | 配置 | 调用时机 |
| --- | --- | --- |
| COMET-ATOMIC 2020 | 从[官方仓库](https://github.com/allenai/comet-atomic-2020#model-comet-atomic-2020)下载 COMET-BART，解压。设置 `NOVIX_COMET_DIR` 为含 `config.json`、分词器和权重的目录。 | 勾选「动机」且有具体行为时，按 xIntent 关系生成备选解释。 |
| GLUCOSE-T5 | 将作者的 GLUCOSE 微调权重准备为 Transformers T5 格式，权重与匹配的分词器放在同一目录，设置 `NOVIX_GLUCOSE_DIR`。 | 勾选「对照 GLUCOSE 事件解释」时，独立生成原因或结果。在「模型与对照结果」查看，不写入人物卡。 |

例如在 macOS 或 Linux 启动前执行 `export NOVIX_COMET_DIR="/实际路径/comet-atomic_2020_BART"`。PowerShell 使用 `$env:NOVIX_COMET_DIR="实际路径"`。GLUCOSE 使用同样的设置方式。应用只读取本地专用权重。普通中文候选可独立使用。

### GLUCOSE 权重格式

[作者仓库](https://github.com/ElementalCognition/glucose)给出微调检查点和原始推理脚本。分享页访问失败时，可在原链接后加 `&download=1`，直接下载官方文件。在仓库之外的模型目录执行。

```sh
curl --fail --location --output glucose_t5_large.tar 'https://comoltd.sharepoint.com/:u:/s/Glucose/Ef2aqIM5YEdFr4aRFDZ-HR0BkMSpNiAHxu6Nz3TnDavHAA?e=9Bbdgg&download=1'
tar -xzf glucose_t5_large.tar
```

本次下载文件为 1,180,919,618 字节，SHA-256 为 `06478070758b8cd0a1ee89116bc112b7c4c36816c9ac79afce09f6d84d798d7f`。解压后检查点前缀为 `large/model.ckpt-1315700`。

已有 Transformers 格式权重可以直接使用。转换官方 TensorFlow 检查点时，可在独立转换环境安装 TensorFlow、PyTorch、sentencepiece 和 Transformers 4.57.6，运行下列 Python。将路径改成实际位置，检查点填写前缀，转换输出目录放在作品和仓库之外。

```python
from transformers import AutoTokenizer, T5Config, T5ForConditionalGeneration
from transformers.models.t5.modeling_t5 import load_tf_weights_in_t5

config = T5Config.from_pretrained("google-t5/t5-large")
model = T5ForConditionalGeneration(config)
load_tf_weights_in_t5(model, config, "/models/glucose/large/model.ckpt-1315700")
model.save_pretrained("/models/glucose-hf")
AutoTokenizer.from_pretrained("google-t5/t5-large").save_pretrained("/models/glucose-hf")
```

通用 T5-large 仅提供配置和分词器。推理需要作者的 GLUCOSE 微调权重。模型结果均为创作候选。

## 人物卡的四重自我

打开人物卡的「从原文分析四重自我」，贴入若干段有角色姓名的原文。勾选个人、社会、核心或隐藏自我。核心可细分为衍生、保护和消失自我。可只生成一项，逐条对照原文、修改文字，再点「采用到人物草稿」并保存。沿用人物卡的「锁定」可冻结已保存字段。证据不足可以留白。

| 工具 | 作用与入口 |
| --- | --- |
| [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) | [Novix 本地发行包](https://github.com/jingui020306-del/novix.ai/releases/latest)内已有的中文模型。可直接从所给材料提出人物理解，也负责把 CHIRON 的保留结果整理为中文候选。每条候选可查看所选原文。 |
| [CHIRON 官方代码](https://github.com/Alex-Gurung/CHIRON/tree/68ebec21202381f58665866e94f3338a851f263a) | 选择「CHIRON · 原文核验后用中文整理」。按原项目顺序运行片段提问、陈述简化、推理、核验打分与去重。仅把保留陈述及对应原文交给 Qwen。四个层面属于 Novix 的整理方式，核验分数针对上游陈述。 |
| [FAtiMA Toolkit](https://github.com/GAIPS/FAtiMA-Toolkit) | 在人物细节填适用处境、可见行动及事件对目标的影响。保存后，双人排演在处境匹配、对方观察到行动时，用已确认的评价计算情绪。已手填的排演设置优先。「隐藏自我」默认仅作者可见。 |

### 安装 CHIRON 官方流程

使用 Linux 或 WSL2、Conda 与支持 vLLM 的 NVIDIA CUDA 环境。从项目根目录运行以下命令。

```bash
bash scripts/setup_chiron.sh
```

安装程序会建立独立环境、安装英文分句模型，随后从 [Novix 权重发布页](https://github.com/jingui020306-del/novix.ai/releases/tag/chiron-weights-v1) 下载分卷、校验 SHA-256 并还原本地模型。默认目录为 `models/chiron/`，可通过 `NOVIX_CHIRON_HOME` 更改。保留下载分卷时，请为分卷和解包后的权重各预留约 30 GB，运行环境另计。若从原作者取权重，运行 `bash scripts/setup_chiron.sh --from-hub`。

生成使用论文的 [Mistral-7B-Instruct-v0.2](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2)，核验使用[作者微调的核验权重](https://huggingface.co/agurung/character_sheet_entailment_model___mistral7bv2)。源码随仓库保存在 `backend/rehearsal_engines/chiron/`，含原 MIT 许可证。保留作者的提问和筛选逻辑，输出文件名按本机路径规则处理，简化未返回内容的条目留空。上游 requirements 的 NumPy 2 与其指定的 vLLM 版本约束冲突，安装使用 NumPy 1.26.4 和 spaCy 3.7.5。中文核验质量需用自己的文本评估。

首次使用双人排演时，可按项目的[引擎安装说明](../backend/rehearsal_engines/install.py)安装 FAtiMA 和 Sabre。Qwen、性格来由的 COMET／GLUCOSE 和本页的 CHIRON 可独立配置。[Novix 人物补全改动](https://github.com/jingui020306-del/novix.ai/pull/30)
