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
