#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

# 一级：表达/修辞/表现/结构/描写/叙事/抒情（思维导图主干）
TOP = [
    ("expression", "表达技法"),
    ("rhetoric", "修辞艺术"),
    ("performance", "表现艺术"),
    ("structure", "结构艺术"),
    ("description", "描写艺术"),
    ("narrative", "叙事艺术"),
    ("lyric", "抒情艺术"),
]

SUB = {
    "expression": ["潜台词", "语气", "句式", "节奏", "口吻", "停顿", "动作替代", "克制", "爆发", "留白"],
    "rhetoric": ["比喻", "比拟", "借代", "夸张", "对偶", "排比", "反复", "设问", "反问", "反讽"],
    "performance": ["对比", "衬托", "象征", "抑扬", "渲染", "留白", "铺垫", "照应", "映衬", "反差"],
    "structure": ["开端", "发展", "高潮", "结局", "伏笔", "回收", "并置", "回环", "跳切", "蒙太奇"],
    "description": ["写景", "写人", "写事", "写物", "写意", "白描", "五感", "动作", "心理", "环境"],
    "narrative": ["顺序", "倒叙", "插叙", "补叙", "平叙", "多线", "视角", "节奏", "悬念", "信息延迟"],
    "lyric": ["直抒", "借景", "托物", "寓情", "含蓄", "反讽抒情", "冷抒情", "克制抒情", "爆发抒情", "对位抒情"],
}

SEED_MICRO = {
    "expression": ["潜台词对话", "短句压迫", "长句铺陈", "动作替代表达", "沉默反应", "语气错位", "句尾留白", "反向台词", "口头禅变奏", "情绪断句", "对白错拍", "内心独白压缩", "话里藏话", "轻描重写", "重话轻说", "重复句式", "节奏换挡", "冷幽默", "欲言又止", "语义回声"],
    "rhetoric": ["隐喻", "象征", "通感", "借代", "排比", "反复", "反讽", "移就", "留白", "夸张", "拟人", "双关", "设问", "反问", "对偶", "顶真", "回环", "层递", "反语", "借喻"],
    "performance": ["张弛控制", "节奏断点", "反高潮", "信息延迟揭示", "误导叙事", "情绪对位", "镜头远近切换", "冲突升级", "缓释冲突", "情绪回摆", "压抑爆发", "静默爆点", "低频高压", "高频碎击", "假线索", "错位对话", "悬置结尾", "硬切收束", "轻落收束", "压迫推进"],
    "structure": ["蒙太奇", "交错剪辑", "平行蒙太奇", "跳切", "倒叙", "插叙", "预叙", "双线并行", "回环结构", "悬念链", "伏笔回收", "章回镜像", "时间折叠", "场景分轨", "节拍锚点", "断章", "拼贴结构", "串珠结构", "三幕递进", "多线汇合"],
    "description": ["环境五感", "空间动线", "静物特写", "以景写情", "侧面描写", "以物写人", "以行写心", "潜台词对话", "身体化情绪", "意识流", "动作分解", "群像切片", "镜头推拉", "手势描写", "气味锚点", "音响描写", "光影描写", "色彩母题", "天气映射", "地理压迫"],
    "narrative": ["冷笔触", "零度写作", "白描", "冰山叙事", "陌生化", "互文", "复调", "不可靠叙述者", "自由间接引语", "克制叙述", "碎片化独白", "心理折射", "多声部叙述", "间离叙述", "省略叙述", "压缩叙述", "叙述留白", "慢镜头叙述", "快切叙述", "对照叙述"],
    "lyric": ["借景抒情", "托物言志", "情景交融", "乐景哀情", "哀景乐情", "含蓄抒情", "直抒胸臆", "冷抒情", "反讽抒情", "对位抒情", "渐进抒情", "突发抒情", "余韵式收束", "尾句留白", "节拍抒情", "回声抒情", "镜像抒情", "压抑抒情", "克制抒情", "爆发抒情"],
}

USAGE_LAYER = {
    "expression": "language",
    "rhetoric": "language",
    "performance": "scene",
    "structure": "structure",
    "description": "scene",
    "narrative": "structure",
    "lyric": "language",
}

LAYER_HINTS = {
    "structure": {
        "suitable": ["开章前", "爆点前", "卷末转折", "多线并行段"],
        "unsuitable": ["需要快速交代事实的短段", "人物情绪刚刚落地的静场"],
        "risks": ["结构痕迹太重", "为了反转牺牲人物动机", "读者看见设计感"],
    },
    "scene": {
        "suitable": ["冲突场", "追逐/对峙", "重要场景进入和退出", "情绪转折段"],
        "unsuitable": ["纯信息摘要", "需要一句话带过的过场"],
        "risks": ["场景拖长", "动作变成流水账", "环境描写压过人物选择"],
    },
    "character": {
        "suitable": ["人物选择前", "关系拉扯", "秘密将露未露", "人物弧光节点"],
        "unsuitable": ["群像快速调度", "纯设定解释"],
        "risks": ["人物变成谜语人", "动机不清", "情绪重复"],
    },
    "language": {
        "suitable": ["关键句", "情绪余韵", "气氛铺垫", "段落收束"],
        "unsuitable": ["动作高速段", "信息必须清晰的规则说明"],
        "risks": ["辞藻堆砌", "语义变虚", "节奏被修辞拖慢"],
    },
}

RECIPES = [
    {
        "id": "technique_recipe_opening_hook",
        "title": "开章钩子配方",
        "description": "用异常细节、信息缺口和延迟解释，让读者愿意进入本章。",
        "steps": ["给出一个异常动作或物件", "让人物反应先于解释", "在段末留下未回答的问题"],
        "techniques": ["信息延迟揭示", "静物特写", "悬置结尾"],
        "signals": ["开头三段内出现异常信号", "解释被合理推迟", "段末出现继续阅读的问题"],
    },
    {
        "id": "technique_recipe_blast_point",
        "title": "爆点配方",
        "description": "把目标受阻、误判升级和代价出现合成一个强事件。",
        "steps": ["明确人物当前目标", "制造一次错误判断", "让代价立刻进入正文"],
        "techniques": ["冲突升级", "误导叙事", "压迫推进"],
        "signals": ["局面发生不可逆变化", "人物付出代价", "下一章目标被迫改变"],
    },
    {
        "id": "technique_recipe_reversal",
        "title": "反转配方",
        "description": "不是单纯给新信息，而是让读者重新理解前文旧细节。",
        "steps": ["选择一个旧细节", "给出新的解释角度", "让人物用行动证明反转成立"],
        "techniques": ["伏笔回收", "信息延迟揭示", "对照叙述"],
        "signals": ["旧细节被重新解释", "反转后人物选择改变", "读者能回查前文证据"],
    },
    {
        "id": "technique_recipe_emotional_tension",
        "title": "感情拉扯配方",
        "description": "用表面拒绝、行动关心和潜台词制造关系张力。",
        "steps": ["让台词保持克制或反向", "让动作泄露真实关心", "用一个小误会推动关系变化"],
        "techniques": ["潜台词对话", "身体化情绪", "错位对话"],
        "signals": ["台词和行动不完全一致", "读者能看见未说出口的情绪", "关系状态发生微小变化"],
    },
    {
        "id": "technique_recipe_mystery_payoff",
        "title": "悬疑回收配方",
        "description": "让线索回收既解释旧疑问，又打开新的问题。",
        "steps": ["回收一个可回查线索", "解释其中一层真相", "留下更高层问题或新风险"],
        "techniques": ["伏笔回收", "假线索", "悬念链"],
        "signals": ["正文出现旧线索 quote", "至少一个疑问被解决", "新的风险替代旧问题"],
    },
]


def write_card(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def payload(name: str, cat_id: str, idx: int) -> dict:
    top_key = cat_id.replace("technique_category_", "")
    layer = USAGE_LAYER.get(top_key, "scene")
    hints = LAYER_HINTS[layer]
    return {
        "name": name,
        "category_id": cat_id,
        "aliases": [name],
        "description": f"{name}：用于提升段落表达与可检验性。",
        "usage_layer": layer,
        "apply_steps": ["明确段落目标", f"在关键句实施{name}", "回读并收束过度使用"],
        "signals": [f"出现{name}可观察信号", "节奏/语义与目标一致"],
        "suitable_scenes": hints["suitable"],
        "unsuitable_scenes": hints["unsuitable"],
        "overuse_risks": hints["risks"],
        "intensity_levels": {"low": "点缀", "med": "贯穿关键段", "high": "成为主导"},
        "metrics": {"dialogue_ratio_range": [0.2, 0.6], "punctuation_caps": 6, "metaphor_density": round(0.03 + (idx % 8) * 0.01, 2)},
        "do_dont": {"do": ["服务目标", "保持可观察"], "dont": ["堆砌", "跑偏"]},
        "examples": [f"示例：用{name}改写一句场景句。"],
        "rewrite_examples": [
            {
                "source": "他走进雨里。",
                "low": f"他走进雨里，{name}只在尾句轻轻点到。",
                "med": f"他走进雨里，动作、环境和停顿都服务于{name}。",
                "high": f"他走进雨里，整段由{name}主导节奏和信息释放。",
            }
        ],
    }


def recipe_payload(recipe: dict) -> dict:
    return {
        "name": recipe["title"],
        "category_id": "technique_category_recipe",
        "aliases": [recipe["title"]],
        "description": recipe["description"],
        "usage_layer": "recipe",
        "apply_steps": recipe["steps"],
        "signals": recipe["signals"],
        "suitable_scenes": ["章节关键节点", "作者需要明确写法目标的段落", "AI 扩写前的共识阶段"],
        "unsuitable_scenes": ["过场摘要", "无需增强戏剧性的说明段"],
        "overuse_risks": ["每章都套同一配方会显得机械", "配方压过人物自然反应"],
        "intensity_levels": {"low": "只取一个步骤", "med": "使用完整三步", "high": "作为本场主设计"},
        "metrics": {"dialogue_ratio_range": [0.15, 0.65], "punctuation_caps": 6, "metaphor_density": 0.05},
        "do_dont": {"do": ["先明确本场目标", "让配方服务人物选择"], "dont": ["只堆事件", "让 AI 自动决定主线"]},
        "examples": [f"示例：用{recipe['title']}处理一个章节关键段。"],
        "rewrite_examples": [
            {
                "source": "他收到一条短信。",
                "low": "他收到一条短信，屏幕上的发件人被雨水模糊。",
                "med": "他收到一条短信，先藏住发件人，只写他突然停下来的反应。",
                "high": "他收到一条短信，异常细节、人物反应和段末问题一起推动下一场。",
            }
        ],
        "recipe_steps": recipe["steps"],
        "recipe_techniques": recipe["techniques"],
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

    write_card(cards_dir / "technique_category_recipe.yaml", {
        "id": "technique_category_recipe",
        "type": "technique_category",
        "title": "场景配方",
        "tags": ["technique", "category", "recipe"],
        "links": [],
        "payload": {"name": "场景配方", "description": "把多个技法组合成作者可直接试用的章节动作。", "sort_order": 99, "tags": ["配方"], "core_techniques": [r["id"] for r in RECIPES]},
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

    for recipe in RECIPES:
        write_card(cards_dir / f"{recipe['id']}.yaml", {
            "id": recipe["id"],
            "type": "technique",
            "title": recipe["title"],
            "tags": ["technique", "recipe", "scene_recipe"],
            "links": ["technique_category_recipe"],
            "payload": recipe_payload(recipe),
        })

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
