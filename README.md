# Novix

Novix 是一款本地小说写作工作台。你可以先安排故事、人物和世界，再进入章节专心写作。作品保存在本机，需要时可用 AI 润色选段或补写正文。

## 首页截图

![Novix 作品总览，左侧为四个创作入口，中间为作品简介和关键事件](https://novix-readme-images.gauzydulse3.chatgpt.site/novix-home.png)

## 环境配置

[Releases](https://github.com/jingui020306-del/novix.ai/releases) 提供含两份模型权重的完整包。将同一版本的 `novix-local.7z.001`、`.002` 等全部分卷下载到同一目录，用 7-Zip 打开第一卷并解压。首次安装仍需联网配置环境。

先安装 [Miniforge 或 Miniconda](https://conda.io/projects/conda/en/latest/user-guide/install/index.html)，在本仓库点 **Code → Download ZIP** 并解压。在包含 `start.py` 的目录打开终端。Windows 可使用 Miniforge Prompt 或 Anaconda Prompt。

**首次安装**只需一条命令。请保持联网，等待终端显示「Novix 已就绪」。

```bash
conda run --no-capture-output -n base python scripts/setup_env.py
```

它会创建独立的 `novix` 环境，安装应用和场景推演所需依赖、构建前端，并下载校验通用模型 Qwen3-1.7B Q8（约 1.83 GB）与节奏模型 Qwen2.5-7B Q4（约 4.68 GB）。权重保存在仓库的 `models/` 下。更新源码后，可再次运行同一条命令。

**日常启动**也在仓库根目录执行。默认模型服务会随 App 一起启动，文字任务已经分配好。浏览器会自动打开本机地址，按 `Ctrl+C` 退出。

```bash
conda run --no-capture-output -n novix python start.py --prod
```

## 电脑配置要求

| 使用方式 | 建议配置 |
| --- | --- |
| 本地写作、场景推演、调用云端 API | 64 位 Windows、macOS 或 Linux，4 核 CPU、8 GB 内存，预留 20 GB 磁盘空间。使用普通浏览器即可，无需独立显卡。 |
| 在本机运行语言模型 | 默认轻量模型可使用 CPU，建议 16 GB 内存。更大模型按其权重和上下文长度准备内存或显存。 |

表中数值是安装和日常使用的建议。大量导入图片、地图或 PDF 时，请另外预留作品空间。

## 模型配置指南

默认本地模型可直接用于文字创作，无需密钥。「模型设置 → 本地模型」可查看加载状态和权重位置。轻量模型适合起步，长篇复杂写作可在此接入更强模型；图片识别需要另配视觉模型。

安装器允许 Conda 根据驱动选择兼容的 llama.cpp 构建。启动器依次加载两个模型，由运行时按可用显存分配 GPU 层。纯 CPU 也可运行两份模型。默认最多使用 8 个 CPU 线程，实际取当前可用数量。进入 `novix` 环境后运行 `llama-server --list-devices` 可检查 CUDA、Metal 或 Vulkan 设备。已有 NVIDIA 环境如仍使用 CPU 构建，可执行 `conda install -n novix -c conda-forge "llama.cpp=12418=cuda*"`。需要固定 CPU 线程或关闭 GPU 卸载时，分别设置环境变量 `LLAMA_ARG_THREADS` 或 `LLAMA_ARG_DEVICE=none`。

多个写作任务同时使用 1.7B 时，启动前设置 `NOVIX_LOCAL_SLOTS=2` 可启用两个并发请求槽。默认 1 槽，每槽保持 16,384 tokens。双槽会为上下文缓存预留更多内存或显存。7B 节奏任务保持单槽。

1. 打开左侧 **作品工具 → 模型设置 → 添加与管理模型**。纯手动写作可以直接开始。
2. 选择服务商，填写自定义的「配置名称」和服务商提供的「模型名称」。云端 API 通常可沿用预设服务地址，再填自己的 API 密钥。使用本地 Ollama 时，先启动服务并下载模型，地址填 `http://127.0.0.1:11434`，模型名称照抄 `ollama list` 的结果。
3. 点击 **保存模型**，在 **任务使用哪个模型** 里把配置分配给「正文写作」「正文审查」或「润色与改写」。同一个模型可以承担多项任务。
4. 验证润色时，进入 **卷与章**，选一小段正文并预览候选。看到真实模型返回的文字即完成连通验证。「模拟预览」用于体验界面。

Conda 启动时，「节奏编排」的总纲、段落标注和「线路与正文」的自动拆解共用同一份 Qwen2.5-7B。沿用独立后端和本机 Ollama 的用户可启动 Ollama，再运行以下命令准备 `qwen2.5:7b`。

```bash
conda run --no-capture-output -n novix python backend/rehearsal_engines/install.py pacing
```

也可用 `docker compose up --build` 安装包含排演环境和 Ollama 节奏模型的版本，完成后打开 `http://127.0.0.1:8000`；正文模型在设置中另行配置。首次需要联网下载依赖和节奏模型，作品仍保存在仓库的 `data` 目录。

## 使用技巧

- **先有全书想法** → 在「作品总览 → 全书构想」写下来，再到「故事安排」把关键事件分到章节。
- **查某一刻发生了什么变化** → 在故事时间线点开事件，查看人物经历或「此时的世界」，再返回原事件继续安排。
- **专心写一章** → 在「卷与章」打开正文，右侧可收起技法栏。选中文字只处理该段，在光标处可补写；要修订整章，点「处理本章」。确认候选后才写入正文。
- **写人物对话** → 人物卡可随机生成人物设定，保留满意的字段，再调整性格和口吻。确认场景安排后，在正文选段里用「按人物写对话」预览台词。
- **备份或交稿** → 在「作品工具 → 模型设置 → 本地数据与安全」导出项目 ZIP 或 Markdown 正文。「作品工具 → 导出」可单独打包选定资料。

正文保存后，后台自动拆解章内选择、后果和信息变化。在「故事安排 → 章节编排 → 线路与正文」切换全书、本幕和本章，点节点定位原句。实线沿用作者已填写的因果，虚线表示带原文的待核对承接。两套本地模型随启动器分别启动，首次分析可能需要等待加载。

每章最近一次完成拆解的耗时保存在 `data/<项目>/meta/pacing/<章节>.json` 的 `timing` 字段。可在自己的 CPU 或 GPU 上查看后台处理毫秒数、模型请求毫秒数、模型调用次数（`model_calls`）、由代码直接识别的明确决定（`rule_blocks`）和复用缓存的段数（`cached_blocks`）。后台计时从开始处理该章算起。
