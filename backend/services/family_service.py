"""Seeded offline family drafts. Adoption uses the existing guarded card journal."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import uuid
from collections import defaultdict, deque
from graphlib import CycleError, TopologicalSorter

from services.author_control_service import AuthorControlService
from services.author_data_service import AuthorDataService, REGISTRY_ID, STAGES_PATH
from services.card_operation_service import CardOperationService
from services.change_suggestion_service import ChangeSuggestionService
from services.edit_version_service import check_revision, revision
from services.world_library_service import WorldLibraryService, encoded
from services.world_scope_service import WorldScopeService, entity_id


VERSION = "family-2"
KINDS = {"parent": "亲生亲子", "adoptive_parent": "收养", "guardian": "监护", "spouse": "配偶", "sibling": "手足"}
DEFAULTS = {
    "surnames": list("沈林周陈江顾苏陆"),
    "given_names": ["安宁", "听澜", "秋白", "南星", "知夏", "若川", "景行", "清和"],
    "traits": ["重诺", "谨慎", "坦率", "随和", "执着", "爱冒险"],
    "identities": ["学徒", "信使", "来访者", "照料家人的人", "记录员", "带路人"],
    "motivations": [
        "想让曾经落空的承诺兑现",
        "想靠自己做成一件事",
        "想弄清故人离开的原因",
        "想为家人争取选择的余地",
    ],
    "vulnerabilities": [
        "怕在需要帮忙时被拒绝",
        "一听到旧日失约便乱了分寸",
        "很难对亲近的人说不",
        "别人质疑其能力时容易冒进",
    ],
    "voices": [
        "回答前总会停一拍",
        "习惯用具体的小事解释自己的想法",
        "越是紧张，句子越短",
        "常用反问试探对方的态度",
    ],
    "forbidden": [],
    "prefix": "",
    "name_order": "surname_first",
    "separator": "",
    "surname_source": "pool",
    "parent_gap": [16, 48],
    "max_age": 125,
    "kinds": list(KINDS),
}
ROOT = "center"
FIELD_NAMES = {"name", "age", "trait"}


PROFILE_FIELDS = {
    "identity": "identities",
    "core_motivation": "motivations",
    "vulnerability": "vulnerabilities",
    "personality_traits": "traits",
    "voice": "voices",
}

# Small, editable tendencies: missing or unrecognized descriptions are neutral.
TRAIT_BIASES = {
    "谨慎": (-0.12, 1),
    "爱冒险": (0.15, -2),
    "坦率": (0.08, 0),
    "执着": (0.09, -1),
    "重诺": (0.04, 0),
    "随和": (0.0, 0),
}


def decision_bias(payload):
    traits = payload.get("personality_traits") or []
    if not isinstance(traits, list):
        return {"confidence_delta": 0.0, "loss_delta": 0}
    biases = [TRAIT_BIASES[t] for t in dict.fromkeys(t for t in traits if isinstance(t, str)) if t in TRAIT_BIASES]
    if not biases:
        return {"confidence_delta": 0.0, "loss_delta": 0}
    return {
        "confidence_delta": round(sum(b[0] for b in biases) / len(biases), 3),
        "loss_delta": round(sum(b[1] for b in biases) / len(biases)),
    }


def preferred_traits(rules, family_trait, similarity):
    return [
        (trait, weight * (1 + similarity if trait == family_trait else 1))
        for trait, weight in weighted(rules["traits"])
    ]


def number(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label}须为 {low} 至 {high} 的整数。")
    return value


def token(*parts):
    raw = json.dumps(parts, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def weighted(pool):
    if isinstance(pool, list):
        if any(not isinstance(key, str) or not key.strip() for key in pool):
            raise ValueError("词库条目须为非空文字。")
        pool = dict.fromkeys(pool, 1)
    if not isinstance(pool, dict) or len(pool) > 2000:
        raise ValueError("姓名或性格词库格式不正确。")
    if any(
        not isinstance(k, str)
        or not k.strip()
        or len(k) > 100
        or type(w) not in (int, float)
        or not math.isfinite(w)
        or w <= 0
        for k, w in pool.items()
    ):
        raise ValueError("词库条目须有文字和正权重。")
    return sorted(pool.items())


def choose(rng, items):
    if not items:
        raise ValueError("词库没有合法候选，请补充词库或调整条件。")
    return rng.choices([key for key, _ in items], weights=[w for _, w in items], k=1)[0]


def generate_field(record, node, field, count=0):
    rules = record["rules"]
    rng = random.Random(
        token(record.get("version", VERSION), record["seed"], record["center_id"], record["scope"], node["slot"], field, count)
    )
    if field == "trait":
        return choose(rng, preferred_traits(rules, record.get("family_trait"), record.get("similarity", 0)))
    surnames = [(node["surname"], 1)] if node.get("surname") else weighted(rules["surnames"])
    given = weighted(rules["given_names"])
    if not given or not surnames:
        raise ValueError("姓氏或名字词库为空。")
    # Filter before sampling; do not loop indefinitely on an exhausted lexicon.
    options = []
    blocked = set(rules["forbidden"])

    def combine(surname, name):
        parts = [surname, rules["prefix"] + name]
        if rules["name_order"] == "given_first":
            parts.reverse()
        return rules["separator"].join(parts)

    if not blocked:
        return combine(choose(rng, surnames), choose(rng, given))

    for surname, weight in surnames:
        if surname in blocked:
            continue
        total = sum(w for name, w in given if name not in blocked and combine(surname, name) not in blocked)
        if total:
            options.append((surname, weight * total))
    surname = choose(rng, options)
    candidates = [
        (combine(surname, name), w)
        for name, w in given
        if name not in blocked and combine(surname, name) not in blocked
    ]
    return choose(rng, candidates)


class FamilyService(CardOperationService):
    def _path(self, identity):
        return f"sessions/families/{entity_id(identity)}.json"

    def _scope(self, project, value, story_id=None):
        world = WorldScopeService(self.store)
        world.validate_context(project, value)
        return world.resolve(project, world_context=value, story_card_id=story_id or value.get("story_card_id"))[
            "scope"
        ]

    def _rules(self, project, scope):
        world = WorldScopeService(self.store)
        world.validate_context(project, scope)
        path = f"cards/{scope['world_id']}.yaml" if scope.get("world_id") else None
        payload = self.store.read_yaml(project, path).get("payload", {}) if path else {}
        if path:
            service = AuthorDataService(self.store)
            stages, _ = service._active_stages(project, "world", scope["world_id"], scope)
            payload, _ = service._apply_changes(project, payload, stages)
            card = self.store.read_yaml(project, path)
            payload, _ = world.apply_overrides(project, card, payload, scope)
        rules = copy.deepcopy(DEFAULTS)
        profiles = payload.get("family_rules", [])
        if not isinstance(profiles, list):
            raise ValueError("世界中的 family_rules 须为规则列表。")
        applied = {}
        for profile in profiles:
            if not isinstance(profile, dict) or not isinstance(profile.get("values"), dict):
                raise ValueError("请核对世界的家族规则条目。")
            world.validate_context(project, profile.get("scope") or {})
            if not world.applies(project, profile.get("scope"), scope)[0]:
                continue
            for key, value in profile["values"].items():
                if key not in DEFAULTS:
                    raise ValueError(f"未识别的家族规则：{key}")
                if key in applied and applied[key][1] != value and profile.get("overrides") != applied[key][0]:
                    raise ValueError(f"家族规则存在冲突：{key}，请明确覆盖的规则。")
                rules[key] = value
                applied[key] = (profile.get("id", ""), value)
        if not isinstance(rules["parent_gap"], list) or len(rules["parent_gap"]) != 2:
            raise ValueError("亲代年龄差须为最小值和最大值。")
        low, high = rules["parent_gap"]
        number(low, "亲代最小年龄差", 0, 100000)
        number(high, "亲代最大年龄差", low, 100000)
        number(rules["max_age"], "最大年龄", 0, 1000000)
        for key in ("surnames", "given_names", *PROFILE_FIELDS.values()):
            weighted(rules[key])
        if (
            not isinstance(rules["forbidden"], list)
            or any(not isinstance(x, str) for x in rules["forbidden"])
            or not isinstance(rules["kinds"], list)
            or any(not isinstance(x, str) or x not in KINDS for x in rules["kinds"])
            or rules["name_order"] not in ("given_first", "surname_first")
            or rules["surname_source"] not in ("pool", "center")
            or any(not isinstance(rules[k], str) for k in ("separator", "prefix"))
        ):
            raise ValueError("命名或关系规则格式不正确。")
        return rules, path

    def profile(self, project, body):
        center = entity_id(body.get("center_id") or "character_new")
        path = f"cards/{center}.yaml"
        card = self.store.read_yaml(project, path)
        if card and card.get("type") != "character":
            raise ValueError("请选择人物资料。")
        payload = card.get("payload") or {}
        scope = self._scope(
            project, body.get("world_context") or payload.get("world_context") or {}, body.get("story_card_id")
        )
        rules, _ = self._rules(project, scope)
        selected = body.get("fields", list(PROFILE_FIELDS))
        settings = payload.get("profile_generation") or {}
        locked = body.get("locked", settings.get("locked", []))
        blank = body.get("blank", settings.get("blank", []))
        counts = body.get("counts", {})
        for keys in (selected, locked, blank):
            if not isinstance(keys, list) or any(not isinstance(k, str) or k not in PROFILE_FIELDS for k in keys):
                raise ValueError("人物生成字段无效。")
        if not isinstance(counts, dict) or counts.keys() - PROFILE_FIELDS.keys():
            raise ValueError("重抽计数无效。")
        for count in counts.values():
            number(count, "重抽次数", 0, 1000000)
        protected = set(locked) | set(blank)
        if "trait" in [*(payload.get("family_locked") or []), *(payload.get("family_blank") or [])]:
            protected.add("personality_traits")
        if card:
            paths = [
                p for lock in AuthorControlService(self.store).get(project, path)["locks"] for p in lock["paths"]
            ]
            for field in selected:
                if any(
                    p in ("/", "/payload", f"/payload/{field}") or p.startswith(f"/payload/{field}/")
                    for p in paths
                ):
                    protected.add(field)
        seed = str(body["seed"]) if body.get("seed") is not None else uuid.uuid4().hex
        family = payload.get("family_source") or {}
        values = {}
        for field in dict.fromkeys(selected):
            if field in protected:
                continue
            rng = random.Random(token("profile-1", seed, scope, center, field, counts.get(field, 0)))
            if field == "personality_traits":
                options = preferred_traits(rules, family.get("family_trait"), family.get("similarity", 0))
                values[field] = [choose(rng, options)]
            else:
                values[field] = choose(rng, weighted(rules[PROFILE_FIELDS[field]]))
        return {"seed": seed, "counts": counts, "values": values, "version": "profile-1"}

    def name(self, project, body):
        scope = self._scope(project, body.get("world_context") or {}, body.get("story_card_id"))
        rules, _ = self._rules(project, scope)
        seed = str(body["seed"]) if body.get("seed") is not None else uuid.uuid4().hex
        surname = body.get("surname", "")
        if not isinstance(surname, str) or len(surname) > 100:
            raise ValueError("姓氏格式不正确。")
        record = {"scope": scope, "seed": seed, "rules": rules, "center_id": body.get("center_id", "")}
        return {
            "name": generate_field(record, {"slot": ROOT, "surname": surname}, "name"),
            "seed": seed,
            "version": VERSION,
        }

    def _relations(self, project, scope):
        svc = AuthorDataService(self.store)
        rows = []
        for row in svc.relationships(project):
            if not svc.world.applies(project, row.get("scope"), scope)[0]:
                continue
            stages, _ = svc._active_stages(project, "relationship", row["id"], scope)
            current, _ = svc._apply_changes(project, row, stages)
            members = current["participants"]
            if len(members) != 2:
                continue
            label = current["label"]
            # Reuse confirmed orientation for recognized family roles, never infer from a name.
            kind = next((key for key, val in KINDS.items() if label == val), None)
            roles = [p.get("role", "") for p in members]
            parents = {"母亲", "父亲", "生父", "生母", "父母", "亲代"}
            if not kind and any(role in parents for role in roles):
                kind = (
                    "parent" if label in {"母子", "母女", "父子", "父女", "亲子", "血亲", "家人", "亲属"} else None
                )
            if (
                not kind
                and label in {"母亲", "父亲", "生母", "生父"}
                and row.get("direction") == "directed"
                and roles[0] in parents
            ):
                kind = "parent"
            if kind:
                if kind == "parent" and roles[1] in parents and roles[0] not in parents:
                    members = members[::-1]
                rows.append(
                    {
                        "id": row["id"],
                        "from_id": members[0]["entity_id"],
                        "to_id": members[1]["entity_id"],
                        "kind": kind,
                        "role": members[0].get("role", ""),
                        "scope": row.get("scope", {}),
                        "existing": True,
                    }
                )
        return rows

    def _existing_node(self, project, identity, slot, role, scope, card=None):
        card = card or self._card(project, identity)
        if card.get("type") != "character" or not WorldScopeService(self.store).card_visible(project, card, scope):
            raise ValueError("请从当前世界选择人物。")
        payload = card["payload"]
        service = AuthorDataService(self.store)
        stages, _ = service._active_stages(project, "character", identity, scope)
        current, _ = service._apply_changes(project, payload, stages)
        for stage in stages:
            naming = stage.get("changes", {}).get("name_change") or {}
            if naming.get("kind") == "rename":
                current["name"] = naming["name"]
        age = WorldScopeService.age(payload, scope)["value"]
        if age is None and (not scope.get("time") or scope.get("time") == payload.get("initial_age_time")):
            age = payload.get("initial_age")
        return {
            "id": identity,
            "slot": slot,
            "role": role,
            "existing": True,
            "name": current.get("name") or "",
            "trait": next(iter(current.get("personality_traits") or []), ""),
            "age": age,
            "locked": list(payload.get("family_locked", [])),
            "blank": list(payload.get("family_blank", [])),
        }

    def tree(self, project, body):
        center = entity_id(body.get("center_id"), "中心人物")
        center_card = self._card(project, center)
        scope = self._scope(
            project,
            body.get("world_context") or center_card["payload"].get("world_context") or {},
            body.get("story_card_id"),
        )
        world = WorldScopeService(self.store)
        by_person = defaultdict(list)
        for edge in self._relations(project, scope):
            by_person[edge["from_id"]].append((edge["to_id"], edge))
            by_person[edge["to_id"]].append((edge["from_id"], edge))
        nodes = {center: self._existing_node(project, center, ROOT, "中心人物", scope, center_card)}
        edges, hidden = {}, set()
        queue = deque([center])
        while queue:
            for person, edge in by_person[queue.popleft()]:
                if person in hidden:
                    continue
                if person not in nodes:
                    card = self.store.read_yaml(project, f"cards/{entity_id(person)}.yaml")
                    if card.get("type") != "character" or not world.card_visible(project, card, scope):
                        hidden.add(person)
                        continue
                    role = card["payload"].get("identity") or card.get("title") or KINDS[edge["kind"]]
                    nodes[person] = self._existing_node(project, person, person, role, scope, card)
                    queue.append(person)
                edges[edge["id"]] = edge
        return {
            "id": "tree-" + center,
            "center_id": center,
            "status": "live",
            "scope": scope,
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
            "conflicts": [],
            "warnings": [],
        }

    def preview(self, project, body):
        with ChangeSuggestionService(self.store).lock(project):
            center = entity_id(body.get("center_id"), "中心人物")
            scope = copy.deepcopy(
                body.get("world_context")
                or self._card(project, center).get("payload", {}).get("world_context")
                or {}
            )
            scope = self._scope(project, scope, body.get("story_card_id"))
            rule_error = None
            try:
                rules, world_path = self._rules(project, scope)
            except ValueError as exc:
                rule_error = str(exc)
                rules, world_path = copy.deepcopy(DEFAULTS), None
            mode = body.get("mode", "maternal")
            if mode not in ("maternal", "paternal", "sister", "brother", "spouse", "name"):
                raise ValueError("请选择一种家谱生成范围。")
            limit = number(body.get("limit", 5), "新增人数", 0, 30)
            generations = number(body.get("generations", 2), "代数", 1, 5)
            seed = str(body["seed"]) if body.get("seed") is not None else uuid.uuid4().hex
            root = self._existing_node(project, center, ROOT, "中心人物", scope)
            rows = self._relations(project, scope)
            record = {
                "id": "family_" + uuid.uuid4().hex[:16],
                "version": VERSION,
                "seed": seed,
                "scope": scope,
                "rules": rules,
                "center_id": center,
                "mode": mode,
                "nodes": [root],
                "edges": [],
                "conflicts": [],
                "warnings": [],
                "status": "draft",
                "basis": {},
                "counts": {},
                "generation_errors": {},
            }
            similarity = body.get("similarity", 0.5)
            if type(similarity) not in (int, float) or not 0 <= similarity <= 1:
                raise ValueError("家族相似度须在 0 至 1 之间。")
            requested_trait = body.get("family_trait") or ""
            if not isinstance(requested_trait, str) or len(requested_trait) > 100:
                raise ValueError("家族性格倾向须为简短文字。")
            pool = weighted(rules["traits"])
            if requested_trait and requested_trait not in dict(pool):
                record["generation_errors"]["family_trait"] = "所选家族倾向不在当前世界的性格词库中。"
            shared = requested_trait or root["trait"]
            if shared not in dict(pool):
                shared = (
                    choose(random.Random(token(VERSION, seed, center, scope, "family_trait")), pool)
                    if pool
                    else ""
                )
            record.update(family_trait=shared, similarity=similarity)
            if world_path:
                record["basis"][world_path] = revision(self.store, project, world_path)
            registry = f"cards/{REGISTRY_ID}.yaml"
            record["basis"][registry] = revision(self.store, project, registry)
            record["basis"][STAGES_PATH] = revision(self.store, project, STAGES_PATH)
            if rule_error:
                record["generation_errors"]["world_rules"] = rule_error
            elif mode == "name":
                if "name" not in root["locked"] + root["blank"]:
                    self._draw(record, root, "name")
            else:
                self._extend(project, record, rows, limit, generations, bool(body.get("blank_names")))
            for node in record["nodes"]:
                if node["existing"]:
                    path = f"cards/{node['id']}.yaml"
                    record["basis"][path] = revision(self.store, project, path)
            self._validate(record, rows)
            self.store.write_json(project, self._path(record["id"]), record)
            return self.get(project, record["id"])

    def _draw(self, record, node, key):
        counter = record["counts"].get(node["id"] + ":" + key, 0)
        try:
            node[key] = generate_field(record, node, key, counter)
            record["generation_errors"].pop(node["id"] + ":" + key, None)
        except ValueError as exc:
            record["generation_errors"][node["id"] + ":" + key] = str(exc)

    def _extend(self, project, r, rows, limit, generations, blank_names):
        mode = r["mode"]
        root = r["nodes"][0]
        first = {
            "maternal": ("母亲", "parent"),
            "paternal": ("父亲", "parent"),
            "sister": ("姐姐", "sibling"),
            "brother": ("弟弟", "sibling"),
            "spouse": ("配偶", "spouse"),
        }[mode]
        queue = deque([(root, first[0], first[1], 1)])
        added = 0
        while queue:
            child, role, kind, depth = queue.popleft()
            slot = child["slot"] + "/" + role
            # Node titles are relative to the central character. Store labels on
            # the edge relative to its own child (a grandmother is that child's mother).
            direct_role = role
            if kind == "parent" and depth > 1:
                direct_role = "母亲" if role.endswith(("母", "母亲")) else "父亲"
            matches = [
                edge
                for edge in rows
                if edge["to_id"] == child["id"] and edge["kind"] == kind and edge["role"] in {direct_role, role}
            ]
            if kind == "spouse":
                matches = [
                    edge
                    if edge["to_id"] == child["id"]
                    else {**edge, "to_id": child["id"], "from_id": edge["to_id"]}
                    for edge in rows
                    if edge["kind"] == kind and child["id"] in (edge["to_id"], edge["from_id"])
                ]

            if len(matches) > 1:
                r["generation_errors"][slot] = "同一位置已有多位候选：" + role
                continue
            if matches:
                identity = matches[0]["from_id"]
                if any(n["id"] == identity for n in r["nodes"]):
                    continue
                node = self._existing_node(project, identity, slot, role, r["scope"])
                r["edges"].append(matches[0])
            else:
                if added >= limit:
                    continue
                identity = "character_" + token(r.get("version", VERSION), r["seed"], r["center_id"], r["scope"], slot)[:18]
                if self.store.read_yaml(project, f"cards/{identity}.yaml"):
                    r["generation_errors"][slot] = "生成身份已存在；请核对亲属或更换种子。"
                    continue
                node = {
                    "id": identity,
                    "slot": slot,
                    "role": role,
                    "name": "",
                    "age": None,
                    "trait": "",
                    "existing": False,
                    "locked": [],
                    "blank": ["name"] if blank_names else [],
                }
                if r["rules"]["surname_source"] == "center" and root["name"]:
                    node["surname"] = next(
                        (
                            s
                            for s, _ in sorted(weighted(r["rules"]["surnames"]), key=lambda v: -len(v[0]))
                            if root["name"].startswith(s)
                        ),
                        "",
                    )
                if not blank_names:
                    self._draw(r, node, "name")
                self._draw(r, node, "trait")
                added += 1
                r["edges"].append(
                    {
                        "id": "relationship_" + token(identity, child["id"], kind)[:18],
                        "from_id": identity,
                        "to_id": child["id"],
                        "kind": kind,
                        "role": direct_role,
                        "scope": r["scope"],
                        "existing": False,
                    }
                )
            r["nodes"].append(node)
            if mode in {"maternal", "paternal"} and kind == "parent" and depth < generations:
                maternal = mode == "maternal"
                prefix = ("外祖" if maternal else "祖") if depth == 1 else node["role"] + "的"
                queue.extend(
                    [
                        (node, prefix + "母" if depth == 1 else prefix + "母亲", "parent", depth + 1),
                        (node, prefix + "父" if depth == 1 else prefix + "父亲", "parent", depth + 1),
                    ]
                )
                if depth == 1:
                    queue.append((node, "舅父" if maternal else "姑母", "sibling", depth))

        self._assign_ages(r)

    @staticmethod
    def _assign_ages(r):
        """Propagate differences before sampling, so an early draw cannot exhaust later generations."""
        maximum = r["rules"]["max_age"]
        nodes = {n["id"]: n for n in r["nodes"]}
        bounds = {key: [n["age"], n["age"]] if n["age"] is not None else [0, maximum] for key, n in nodes.items()}
        constraints = []
        connected = set(n["id"] for n in nodes.values() if n["age"] is not None)
        for edge in r["edges"]:
            kind = edge["kind"]
            if kind == "parent":
                lo, hi = r["rules"]["parent_gap"]
            elif kind == "sibling" and edge["role"] in {"姐姐", "弟弟"}:
                lo, hi = (1, maximum) if edge["role"] == "姐姐" else (-maximum, -1)
            else:
                continue
            constraints.append((edge["from_id"], edge["to_id"], lo, hi))

        def propagate():
            for _ in range(len(nodes) + 1):
                changed = False
                for parent, child, lo, hi in constraints:
                    a, b = bounds[parent], bounds[child]
                    left = [max(a[0], b[0] + lo), min(a[1], b[1] + hi)]
                    right = [max(b[0], a[0] - hi), min(b[1], a[1] - lo)]
                    if left[0] > left[1] or right[0] > right[1]:
                        return False
                    if left != a or right != b:
                        bounds[parent], bounds[child] = left, right
                        changed = True
                    if (parent in connected) != (child in connected):
                        connected.update((parent, child))
                        changed = True
                if not changed:
                    return True
            return False

        pending = {key for key, n in nodes.items() if not n["existing"]}
        while propagate():
            available = pending & connected
            if not available:
                return
            key = min(available, key=lambda i: (bounds[i][1] - bounds[i][0], nodes[i]["slot"]))
            left, right = bounds[key]
            if math.ceil(left) > math.floor(right):
                break
            rng = random.Random(token(r.get("version", VERSION), r["seed"], r["scope"], nodes[key]["slot"], "age"))
            age = rng.randint(math.ceil(left), math.floor(right))
            nodes[key]["age"] = age
            bounds[key] = [age, age]
            pending.remove(key)
        # The regular graph validation also runs after each manual edit.
        r["warnings"].append("亲缘年龄区间无解，未确定的年龄已留白，请调整亲缘或规则。")

    @staticmethod
    def _patches(body, name):
        items = body.get(name, [])
        if not isinstance(items, list) or len(items) > 100 or any(not isinstance(item, dict) for item in items):
            raise ValueError("预览修改须为有效的变更列表。")
        return items

    def _validate(self, record, existing):
        nodes = {n["id"]: n for n in record["nodes"]}
        rules = record["rules"]
        errors = []
        targets = defaultdict(list)

        def report(message, *identities):
            errors.append(message)
            for identity in identities:
                targets[identity].append(message)

        for field, message in record["generation_errors"].items():
            target = field.partition(":")[0]
            report(message, *([target] if target in nodes else []))
        graph = TopologicalSorter()
        seen = set()
        for e in [*existing, *[item for item in record["edges"] if not item["existing"]]]:
            a, b, k = e["from_id"], e["to_id"], e["kind"]
            if k == "parent":
                graph.add(b, a)
            key = (a, b, k) if k not in ("sibling", "spouse") else (*sorted((a, b)), k)
            if not e["existing"]:
                if key in seen or a == b or a not in nodes or b not in nodes or k not in rules["kinds"]:
                    report("关系重复、参与者无效或不符合世界规则：" + e["role"], e["id"])
                elif nodes[a]["age"] is not None and nodes[b]["age"] is not None:
                    d = nodes[a]["age"] - nodes[b]["age"]
                    lo, hi = rules["parent_gap"]
                    if (
                        k == "parent"
                        and not lo <= d <= hi
                        or k == "sibling"
                        and (e["role"] == "姐姐" and d <= 0 or e["role"] == "弟弟" and d >= 0)
                    ):
                        report("亲缘年龄与世界规则冲突：" + e["role"], e["id"], a, b)
            seen.add(key)
        try:
            graph.prepare()
        except CycleError as exc:
            report("血缘祖先链存在循环。", *(n for n in dict.fromkeys(exc.args[1]) if n in nodes))
        for n in nodes.values():
            if not n["existing"] and n["name"] in rules["forbidden"]:
                report("姓名属于该世界的禁用项。", n["id"])
            if n["age"] is not None and not 0 <= n["age"] <= rules["max_age"]:
                report(n["role"] + "的年龄超出世界范围。", n["id"])
        check = copy.deepcopy(record)
        check["warnings"] = []
        for n in check["nodes"]:
            n["existing"] = True
        self._assign_ages(check)
        errors.extend(check["warnings"])
        record["conflicts"] = list(dict.fromkeys(errors))
        record["conflict_targets"] = dict(targets)

    def update(self, project, identity, body):
        with ChangeSuggestionService(self.store).lock(project):
            path = self._path(identity)
            check_revision(self.store, project, path, body.get("revision", ""))
            r = self.store.read_json(project, path)
            if r.get("status") != "draft":
                raise ValueError("请选择可编辑的家族草稿。")
            nodes = {n["id"]: n for n in r["nodes"]}
            for change in self._patches(body, "nodes"):
                node = nodes.get(entity_id(change.get("id")))
                if not node:
                    raise ValueError("未找到人物。")
                for field in ("locked", "blank"):
                    if field in change:
                        values = change[field]
                        if not isinstance(values, list) or any(
                            not isinstance(v, str) or v not in FIELD_NAMES for v in values
                        ):
                            raise ValueError("锁定或留白字段无效。")
                        node[field] = list(dict.fromkeys(values))
                for field in FIELD_NAMES:
                    if field not in change and not ("blank" in change and field in node["blank"]):
                        continue
                    value = change.get(field)
                    if field in node["blank"]:
                        value = None if field == "age" else ""
                    elif field == "age" and value is not None:
                        number(value, "年龄", 0, 1000000)
                    elif field != "age" and (not isinstance(value, str) or len(value) > 200):
                        raise ValueError("姓名与性格须为200字以内文字。")
                    node[field] = value
                    r["generation_errors"].pop(node["id"] + ":" + field, None)
            edges = {e["id"]: e for e in r["edges"]}
            for change in self._patches(body, "edges"):
                edge = edges.get(entity_id(change.get("id")))
                if not edge or edge["existing"]:
                    raise ValueError("请在共享关系页修改已保存的关系。")
                for key in ("kind", "from_id", "to_id", "scope"):
                    if key in change:
                        edge[key] = change[key] if key == "scope" else entity_id(change[key])
                if edge["kind"] not in KINDS or edge["from_id"] not in nodes or edge["to_id"] not in nodes:
                    raise ValueError("请选择预览内的人物和关系类型。")
                WorldScopeService(self.store).validate_context(project, edge["scope"])
            if "omit_ids" in body:
                omit = body["omit_ids"]
                if not isinstance(omit, list) or any(
                    not isinstance(key, str) or key not in nodes or nodes[key]["existing"] for key in omit
                ):
                    raise ValueError("仅可从预览中移除新增人物。")
                allowed = set(nodes) - set(omit)
                neighbours = {key: set() for key in allowed}
                for edge in r["edges"]:
                    a, b = edge["from_id"], edge["to_id"]
                    if a in allowed and b in allowed:
                        neighbours[a].add(b)
                        neighbours[b].add(a)
                retained = set()
                todo = [r["center_id"]]
                while todo:
                    key = todo.pop()
                    if key not in retained:
                        retained.add(key)
                        todo.extend(neighbours[key] - retained)
                r["nodes"] = [n for n in r["nodes"] if n["id"] in retained]
                r["edges"] = [e for e in r["edges"] if e["from_id"] in retained and e["to_id"] in retained]
                r["generation_errors"] = {
                    k: v
                    for k, v in r["generation_errors"].items()
                    if k.split(":")[0] not in (set(nodes) - retained)
                }
                nodes = {n["id"]: n for n in r["nodes"]}
            reroll = body.get("reroll")
            if reroll:
                if not isinstance(reroll, dict):
                    raise ValueError("请选择重抽字段。")
                node = nodes.get(entity_id(reroll.get("node_id")))
                field = reroll.get("field")
                if not node or field not in ("name", "trait") or field in node["locked"] + node["blank"]:
                    raise ValueError("此字段已锁定、留白或不可重抽。")
                key = node["id"] + ":" + field
                r["counts"][key] = r["counts"].get(key, 0) + 1
                self._draw(r, node, field)
            self._validate(r, self._relations(project, r["scope"]))
            self.store.write_json(project, path, r)
            return self.get(project, identity)

    def _plan(self, project, r):
        operations = []

        def save(path, before, after):
            target = self.store._safe_path(project, path)
            operations.append(
                {
                    "path": path,
                    "kind": "replace",
                    "before": target.read_text("utf-8") if target.exists() else None,
                    "before_value": before,
                    "after": encoded(after),
                    "after_value": after,
                }
            )

        for n in r["nodes"]:
            path = f"cards/{n['id']}.yaml"
            original = self.store.read_yaml(project, path)
            if not n["existing"] and original:
                raise FileExistsError("候选编号已被使用。")
            card = (
                copy.deepcopy(original)
                if original
                else {
                    "id": n["id"],
                    "type": "character",
                    "title": n["role"],
                    "tags": [],
                    "links": [],
                    "payload": {
                        "identity": n["role"],
                        "detail_level": "brief",
                        "world_context": r["scope"],
                        "family_source": {
                            "preview": r["id"],
                            "slot": n["slot"],
                            "generator": r.get("version", VERSION),
                            "family_trait": r.get("family_trait", ""),
                            "similarity": r.get("similarity", 0),
                        },
                    },
                }
            )
            payload = card["payload"]
            base = self._existing_node(project, n["id"], n["slot"], n["role"], r["scope"]) if original else {}
            if original and (
                (n["name"] != base["name"] and base["name"] != payload.get("name", ""))
                or (
                    n["trait"] != base["trait"]
                    and base["trait"] != next(iter(payload.get("personality_traits") or []), "")
                )
            ):
                raise ValueError("此字段已有阶段设定，请从该人物的阶段记录修订。")
            if not original or n["name"] != base["name"]:
                if original and payload.get("name") and payload["name"] != n["name"]:
                    payload["aliases"] = list(dict.fromkeys([*(payload.get("aliases") or []), payload["name"]]))
                payload["name"] = n["name"]
                card["title"] = n["name"] or payload.get("identity") or n["role"]
            if not original or n["trait"] != base["trait"]:
                payload["personality_traits"] = [
                    s for s in [n["trait"], *(payload.get("personality_traits") or [])[1:]] if s
                ]
            original_age = base.get("age")
            if n["age"] != original_age:
                if n["age"] is None:
                    payload.pop("initial_age", None)
                    payload.pop("initial_age_time", None)
                else:
                    payload["initial_age"] = n["age"]
                    payload["initial_age_time"] = r["scope"].get("time", {})
            for key in ("blank", "locked"):
                if n[key] or "family_" + key in payload:
                    payload["family_" + key] = n[key]
            if card != original:
                save(path, original or None, card)
        new_edges = [e for e in r["edges"] if not e["existing"]]
        if new_edges:
            path = f"cards/{REGISTRY_ID}.yaml"
            original = self.store.read_yaml(project, path)
            card = copy.deepcopy(original) or {
                "id": REGISTRY_ID,
                "title": "共享人物关系",
                "type": "outline",
                "tags": [],
                "links": [],
                "payload": {},
            }
            registry = card["payload"].setdefault("relationship_registry", [])
            for e in new_edges:
                kind = e["kind"]
                start_role = e["role"] if kind in ("parent", "sibling") else KINDS[kind]
                members = [{"entity_id": e["from_id"], "role": start_role}, {"entity_id": e["to_id"], "role": ""}]
                row = AuthorDataService(self.store).prepare_relationship(
                    project,
                    {
                        "id": e["id"],
                        "label": KINDS[kind],
                        "scope": e["scope"],
                        "direction": "undirected" if kind in ("sibling", "spouse") else "directed",
                        "participants": members,
                        "sources": [{"path": self._path(r["id"]), "generator": r.get("version", VERSION)}],
                    },
                    extra_entities={n["id"]: "character" for n in r["nodes"]},
                )
                registry.append(row)
            save(path, original or None, card)
        return operations

    def apply(self, project, identity, body):
        with ChangeSuggestionService(self.store).lock(project):
            path = self._path(identity)
            r = self.store.read_json(project, path)
            if r.get("status") == "draft":
                check_revision(self.store, project, path, body.get("revision", ""))
                for source, version in r["basis"].items():
                    check_revision(self.store, project, source, version)
                self._validate(r, self._relations(project, r["scope"]))
                if r["conflicts"]:
                    raise ValueError("；".join(r["conflicts"]))
                r["operations"] = self._plan(project, r)
                WorldLibraryService(self.store)._check_operations(project, r["operations"])
                r["can_apply"] = True
                self.store.write_json(project, path, r)
                body = {"revision": revision(self.store, project, path)}
            return self._journal(project, identity, body, undo=False)

    def undo(self, project, identity, body):
        with ChangeSuggestionService(self.store).lock(project):
            r = self.store.read_json(project, self._path(identity))
            if r.get("status") == "applied":
                new = {n["id"] for n in r["nodes"] if not n["existing"]} | {
                    e["id"] for e in r["edges"] if not e["existing"]
                }
                changed = {o["path"] for o in r["operations"]}
                base = self.store._project_dir(project)
                for folder in ("cards", "drafts", "canon"):
                    for item in (base / folder).glob("*"):
                        if (
                            item.suffix not in (".yaml", ".json", ".md", ".jsonl")
                            or str(item.relative_to(base)) in changed
                        ):
                            continue
                        content = item.read_text("utf-8")
                        if any(i in content for i in new):
                            raise FileExistsError("后续资料仍引用本批对象：" + item.name)
            return self._journal(project, identity, body, undo=True)

    def _journal(self, project, identity, body, *, undo):
        pending = "sessions/families/pending.json"
        state = self.store.read_json(project, pending)
        if state.get("id") and state["id"] != identity:
            self.recover_pending(project)
        self.store.write_json(project, pending, {"id": identity})
        try:
            return super().undo(project, identity, body) if undo else super().apply(project, identity, body)
        finally:
            record = self.store.read_json(project, self._path(identity))
            if record.get("status") not in ("applying", "undoing"):
                self.store._safe_path(project, pending).unlink(missing_ok=True)

    def recover_pending(self, project):
        pending = "sessions/families/pending.json"
        if not self.store._safe_path(project, pending).is_file():
            return
        with ChangeSuggestionService(self.store).lock(project):
            identity = self.store.read_json(project, pending).get("id")
            if not identity:
                return
            r = self.store.read_json(project, self._path(identity))
            if r.get("status") in ("applying", "undoing"):
                self._execute(project, r, undo=r["status"] == "undoing")
            self.store._safe_path(project, pending).unlink(missing_ok=True)
