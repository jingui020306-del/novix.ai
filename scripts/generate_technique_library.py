#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

# 一级：修辞/表现/结构/描写/叙事/抒情（思维导图主干）
TOP = [
    ("rhetoric", "修辞艺术"),
    ("performance", "表现艺术"),
    ("structure", "结构艺术"),
    ("description", "描写艺术"),
    ("narrative", "叙事艺术"),
    ("lyric", "抒情艺术"),
]

SUB = {
    "rhetoric": ["比喻", "比拟", "借代", "夸张", "对偶", "排比", "反复", "设问", "反问", "反讽"],
    "performance": ["对比", "衬托", "象征", "抑扬", "渲染", "留白", "铺垫", "照应", "映衬", "反差"],
    "structure": ["开端", "发展", "高潮", "结局", "伏笔", "回收", "并置", "回环", "跳切", "蒙太奇"],
    "description": ["写景", "写人", "写事", "写物", "写意", "白描", "五感", "动作", "心理", "环境"],
    "narrative": ["顺序", "倒叙", "插叙", "补叙", "平叙", "多线", "视角", "节奏", "悬念", "信息延迟"],
    "lyric": ["直抒", "借景", "托物", "寓情", "含蓄", "反讽抒情", "冷抒情", "克制抒情", "爆发抒情", "对位抒情"],
}

SEED_MICRO = {
    "rhetoric": ["隐喻", "象征", "通感", "借代", "排比", "反复", "反讽", "移就", "留白", "夸张", "拟人", "双关", "设问", "反问", "对偶", "顶真", "回环", "层递", "反语", "借喻"],
    "performance": ["张弛控制", "节奏断点", "反高潮", "信息延迟揭示", "误导叙事", "情绪对位", "镜头远近切换", "冲突升级", "缓释冲突", "情绪回摆", "压抑爆发", "静默爆点", "低频高压", "高频碎击", "假线索", "错位对话", "悬置结尾", "硬切收束", "轻落收束", "压迫推进"],
    "structure": ["蒙太奇", "交错剪辑", "平行蒙太奇", "跳切", "倒叙", "插叙", "预叙", "双线并行", "回环结构", "悬念链", "伏笔回收", "章回镜像", "时间折叠", "场景分轨", "节拍锚点", "断章", "拼贴结构", "串珠结构", "三幕递进", "多线汇合"],
    "description": ["环境五感", "空间动线", "静物特写", "以景写情", "侧面描写", "以物写人", "以行写心", "潜台词对话", "身体化情绪", "意识流", "动作分解", "群像切片", "镜头推拉", "手势描写", "气味锚点", "音响描写", "光影描写", "色彩母题", "天气映射", "地理压迫"],
    "narrative": ["冷笔触", "零度写作", "白描", "冰山叙事", "陌生化", "互文", "复调", "不可靠叙述者", "自由间接引语", "克制叙述", "碎片化独白", "心理折射", "多声部叙述", "间离叙述", "省略叙述", "压缩叙述", "叙述留白", "慢镜头叙述", "快切叙述", "对照叙述"],
    "lyric": ["借景抒情", "托物言志", "情景交融", "乐景哀情", "哀景乐情", "含蓄抒情", "直抒胸臆", "冷抒情", "反讽抒情", "对位抒情", "渐进抒情", "突发抒情", "余韵式收束", "尾句留白", "节拍抒情", "回声抒情", "镜像抒情", "压抑抒情", "克制抒情", "爆发抒情"],
}


def write_card(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def payload(name: str, cat_id: str, idx: int) -> dict:
    return {
        "name": name,
        "category_id": cat_id,
        "aliases": [name],
        "description": f"{name}：用于提升段落表达与可检验性。",
        "apply_steps": ["明确段落目标", f"在关键句实施{name}", "回读并收束过度使用"],
        "signals": [f"出现{name}可观察信号", "节奏/语义与目标一致"],
        "intensity_levels": {"low": "点缀", "med": "贯穿关键段", "high": "成为主导"},
        "metrics": {"dialogue_ratio_range": [0.2, 0.6], "punctuation_caps": 6, "metaphor_density": round(0.03 + (idx % 8) * 0.01, 2)},
        "do_dont": {"do": ["服务目标", "保持可观察"], "dont": ["堆砌", "跑偏"]},
        "examples": [f"示例：用{name}改写一句场景句。"],
    }


def generate(cards_dir: Path) -> None:
    # clean previous generated technique files
    for f in cards_dir.glob('technique_*.yaml'):
        f.unlink()
    for f in cards_dir.glob('technique_category_*.yaml'):
        f.unlink()

    cat_ids = []
    counter = 1
    cat_to_core: dict[str, list[str]] = {}

    # 一级 + 二级分类卡
    for i, (key, name) in enumerate(TOP, start=1):
        top_id = f"technique_category_{key}"
        cat_ids.append(top_id)
        write_card(cards_dir / f"{top_id}.yaml", {
            "id": top_id,
            "type": "technique_category",
            "title": name,
            "tags": ["technique", "category", "macro"],
            "links": [],
            "payload": {"name": name, "description": f"{name}一级分类", "sort_order": i, "tags": ["一级"], "core_techniques": []},
        })
        for j, sub in enumerate(SUB[key], start=1):
            sid = f"technique_category_{key}_{j:02d}"
            cat_ids.append(sid)
            write_card(cards_dir / f"{sid}.yaml", {
                "id": sid,
                "type": "technique_category",
                "title": f"{name}/{sub}",
                "tags": ["technique", "category", "micro-group"],
                "links": [top_id],
                "payload": {"name": sub, "parent_id": top_id, "description": f"{name}·{sub}", "sort_order": j, "tags": ["二级"], "core_techniques": []},
            })

    # micro 技法，目标 >= 200
    all_micro = []
    for key, _ in TOP:
        all_micro.extend([(key, n) for n in SEED_MICRO[key]])
    idx = len(all_micro)
    while len(all_micro) < 210:
        key, _ = TOP[len(all_micro) % len(TOP)]
        idx += 1
        all_micro.append((key, f"{key}_扩展技法_{idx:03d}"))

    for key, name in all_micro:
        top_id = f"technique_category_{key}"
        tid = f"technique_{counter:03d}"
        write_card(cards_dir / f"{tid}.yaml", {
            "id": tid,
            "type": "technique",
            "title": name,
            "tags": ["technique", key],
            "links": [top_id],
            "payload": payload(name, top_id, counter),
        })
        cat_to_core.setdefault(top_id, []).append(tid)
        counter += 1

    # 回填一级分类 core_techniques (10~20)
    for key, _ in TOP:
        top_id = f"technique_category_{key}"
        p = cards_dir / f"{top_id}.yaml"
        card = json.loads(p.read_text(encoding='utf-8'))
        card["payload"]["core_techniques"] = cat_to_core.get(top_id, [])[:15]
        write_card(p, card)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    cards_dir = root / "data" / "demo_project_001" / "cards"
    generate(cards_dir)
    print("Generated macro/micro technique library into demo_project_001/cards")


if __name__ == "__main__":
    main()
