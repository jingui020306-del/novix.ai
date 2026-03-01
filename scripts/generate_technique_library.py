#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

CATEGORIES = [
    ("technique_category_expression", "表达手法", "表达层面的语气与叙述组织"),
    ("technique_category_rhetoric", "修辞手法", "修辞与语义强化"),
    ("technique_category_structure", "结构手法", "时间线、镜头、结构编排"),
    ("technique_category_description", "描写方法", "场景/人物/动作描写策略"),
    ("technique_category_performance", "表现手法", "节奏控制与情绪呈现"),
]

SEED_NAMES = {
    "technique_category_expression": ["冷笔触", "零度写作", "白描", "冰山叙事", "陌生化", "互文", "复调", "不可靠叙述者", "自由间接引语", "克制叙述", "碎片化独白", "心理折射", "多声部叙述", "间离叙述", "省略叙述", "压缩叙述", "叙述留白", "慢镜头叙述", "快切叙述", "对照叙述", "镜像叙述", "反向叙述", "视角漂移", "限定视角", "旁观视角"],
    "technique_category_rhetoric": ["隐喻", "象征", "通感", "借代", "排比", "反复", "反讽", "移就", "留白", "夸张", "拟人", "双关", "设问", "反问", "对偶", "顶真", "回环", "层递", "反语", "借喻", "明喻", "暗喻", "提喻", "婉曲", "映衬"],
    "technique_category_structure": ["蒙太奇", "交错剪辑", "平行蒙太奇", "跳切", "倒叙", "插叙", "预叙", "双线并行", "回环结构", "悬念链", "伏笔回收", "章回镜像", "时间折叠", "场景分轨", "节拍锚点", "断章", "拼贴结构", "串珠结构", "三幕递进", "多线汇合", "反向揭示", "闭环结构", "递归叙事", "桥段重演", "视角接力"],
    "technique_category_description": ["环境五感", "空间动线", "静物特写", "以景写情", "侧面描写", "以物写人", "以行写心", "潜台词对话", "身体化情绪", "意识流", "动作分解", "群像切片", "镜头推拉", "手势描写", "气味锚点", "音响描写", "光影描写", "色彩母题", "天气映射", "地理压迫", "道具叙事", "衣着叙事", "视线调度", "节奏停顿", "场景回声"],
    "technique_category_performance": ["张弛控制", "节奏断点", "反高潮", "信息延迟揭示", "误导叙事", "情绪对位", "镜头远近切换", "冲突升级", "缓释冲突", "情绪回摆", "压抑爆发", "静默爆点", "低频高压", "高频碎击", "假线索", "错位对话", "悬置结尾", "硬切收束", "轻落收束", "压迫推进", "目标错配", "视听反差", "节律递增", "节律递减", "停顿增压"],
}


def technique_payload(name: str, category_id: str, idx: int) -> dict:
    return {
        "name": name,
        "category_id": category_id,
        "aliases": [name],
        "description": f"{name}用于提升叙事可读性与可检验性。",
        "apply_steps": [
            "明确场景目标与情绪方向",
            f"在关键句应用{name}并保持一致",
            "收束段落并回看是否过度",
        ],
        "signals": [
            f"出现{name}相关的语言痕迹",
            "段落节奏与目标强度一致",
        ],
        "intensity_levels": {
            "low": "点到即止，单段使用",
            "med": "贯穿场景关键段",
            "high": "成为本场景主导手法",
        },
        "metrics": {
            "dialogue_ratio_range": [0.2, 0.6],
            "punctuation_caps": 6,
            "metaphor_density": round(0.04 + (idx % 6) * 0.01, 2),
        },
        "do_dont": {
            "do": ["围绕目标服务", "保持信号可观察"],
            "dont": ["连续堆叠导致噪音", "破坏角色一致性"],
        },
        "examples": [f"示例：用{name}重写一句关键动作。"],
    }


def write_json_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def generate(project_cards_dir: Path) -> None:
    for i, (cid, name, desc) in enumerate(CATEGORIES, start=1):
        card = {
            "id": cid,
            "type": "technique_category",
            "title": name,
            "tags": ["technique", "category"],
            "links": [],
            "payload": {
                "name": name,
                "description": desc,
                "sort_order": i,
                "tags": ["技法", "分类"],
            },
        }
        write_json_yaml(project_cards_dir / f"{cid}.yaml", card)

    counter = 1
    for cid, _, _ in CATEGORIES:
        names = SEED_NAMES[cid]
        for name in names:
            tid = f"technique_{counter:03d}"
            card = {
                "id": tid,
                "type": "technique",
                "title": name,
                "tags": ["technique", cid.replace("technique_category_", "")],
                "links": [cid],
                "payload": technique_payload(name, cid, counter),
            }
            write_json_yaml(project_cards_dir / f"{tid}.yaml", card)
            counter += 1

    while counter <= 120:
        cid, cname, _ = CATEGORIES[(counter - 1) % len(CATEGORIES)]
        name = f"{cname}扩展技法{counter:03d}"
        tid = f"technique_{counter:03d}"
        card = {
            "id": tid,
            "type": "technique",
            "title": name,
            "tags": ["technique", "generated"],
            "links": [cid],
            "payload": technique_payload(name, cid, counter),
        }
        write_json_yaml(project_cards_dir / f"{tid}.yaml", card)
        counter += 1


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    generate(root / "data" / "demo_project_001" / "cards")
    print("Generated technique library into demo_project_001/cards")
