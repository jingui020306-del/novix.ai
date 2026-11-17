"""Derive a local candidate when a scene is ready; only explicit confirmation saves a plan."""
import copy
import hashlib
import json
import logging
from collections import OrderedDict
from threading import Lock
from time import monotonic

from pydantic import ValidationError

from services.local_rehearsal import CastRehearsal, Choices, LocalRehearsal, Participant, rehearse, scene_cast, simulation_format

logger = logging.getLogger(__name__)
_cache = OrderedDict()
_cache_lock = Lock()
# A bounded set of locks coalesces concurrent polling and post-save work.
_workers = [Lock() for _ in range(32)]


def initial_spec(snapshot):
    context = snapshot['context']
    cast = scene_cast(context)
    if not cast:
        return None
    saved = snapshot['draft'].get('local_simulation')
    previous = None
    if isinstance(saved, dict):
        try:
            previous = simulation_format.validate_python(saved)
        except ValidationError:
            previous = None
        if isinstance(previous, CastRehearsal) and {p.actor_id for p in previous.participants} == set(cast):
            return previous
        if isinstance(previous, LocalRehearsal) and {previous.actor_id, previous.partner_id} == set(cast):
            return previous
    scene = context['scene']['values']
    # Use the order of an authored interaction when it identifies both participants.
    exchange = next((r['values'] for r in context['intersections']
                     if len(set(r['values'].get('characters') or []) & cast.keys()) >= 2), {})
    ordered = list(dict.fromkeys([*(exchange.get('characters') or []), *(scene.get('characters') or []),
                                  *(scene.get('cast') or []), *cast]))
    ordered = [key for key in ordered if key in cast]
    if len(ordered) != 2:
        return cast_spec(context, cast, ordered, previous)
    first, other = ordered
    choices = Choices(act='表明自己的打算', hold='暂不表态', effect='对方已经听到这一打算',
                      respond='作出回应', check='先问清对方的意思')
    # The outcome of a completed exchange cannot be used as its own precondition.
    fields = [exchange.get(k) for k in ('protagonist_action', 'opponent_action')]
    if all(isinstance(value, str) and value.strip() and len(value.strip()) <= 120 for value in fields):
        act, respond = [v.strip() for v in fields]
        if act != choices.hold and respond != choices.check:
            choices = Choices(act=act, hold=choices.hold, effect='对方观察到了这一行动', respond=respond, check=choices.check)
    goal = next((r['values'].get('goal') for r in context['storylines']
                 if r['values'].get('character_id') == first and r['values'].get('goal')), None)
    topic = next((v.strip() for v in (exchange.get('goal'), goal, cast[first]['payload'].get('core_motivation'), scene.get('scene'), scene.get('purpose'),
                                      scene.get('plot')) if isinstance(v, str) and v.strip()), '本场人物的意图')
    return LocalRehearsal(actor_id=first, partner_id=other, topic=topic[:120], available=True,
                          actor_confidence=0.7, partner_confidence=0.7, choices=choices)


def cast_spec(context, cast, ordered, previous):
    def short(value):
        return value.strip()[:120] if isinstance(value, str) else ''

    scene = context['scene']['values']
    goals, actions, addressed = {}, {}, set()
    for row in context['storylines']:
        story = row['values']
        person = story.get('character_id')
        if short(story.get('goal')):
            goals[person] = short(story['goal'])
        if short(story.get('choice')):
            actions[person] = short(story['choice'])
    for row in context['intersections']:
        exchange = row['values']
        speakers = exchange.get('characters') or []
        if len(speakers) == 2 and short(exchange.get('protagonist_action')) and short(exchange.get('opponent_action')):
            addressed.add(tuple(speakers))
        for person, field in zip(speakers, ('protagonist_action', 'opponent_action')):
            if short(exchange.get(field)):
                actions.setdefault(person, short(exchange[field]))
    old = {p.actor_id: p for p in previous.participants} if isinstance(previous, CastRehearsal) else {}
    participants = []
    for index, person in enumerate(ordered):
        if person in old:
            part = old[person]
            if part.visible_to is not None:
                part = part.model_copy(update={'visible_to': [witness for witness in part.visible_to if witness in cast]})
            participants.append(part)
            continue
        goal = goals.get(person) or short(cast[person]['payload'].get('core_motivation'))
        audience = None
        if person in actions:
            act = actions[person]
            # An authored choice may be private. The author can supply its public effect.
            next_actor = ordered[index + 1] if index + 1 < len(ordered) else None
            effect = ''
            if (person, next_actor) in addressed:
                effect, audience = '对方观察到了这一行动', [next_actor]
        elif len(ordered) == 1:
            act = short(scene.get('attack')) or (f'着手为“{goal}”做准备'[:120] if goal else '')
            effect = ''
        elif index == 0:
            act, effect = '开口提出请求', '有人提出了请求'
        else:
            act, effect = '提出自己的条件', '有人提出了条件'
        previous_risk = (context.get('previous_scene') or {}).get('actor_risks', {}).get(person, {}) if len(ordered) == 1 else {}
        participants.append(Participant(actor_id=person, goal=goal, act=act, hold='暂缓行动' if act else '',
                                        effect=effect, visible_to=audience, **previous_risk))
    return CastRehearsal(mode='solo' if len(ordered) == 1 else 'ensemble',
                         topic=short(scene.get('scene')), participants=participants)


def candidate(namespace, snapshot, engines, *, compute):
    spec = initial_spec(snapshot)
    if spec is None:
        return {'status': 'waiting', 'notice': '本场关联人物后即可排演。'}
    settings = spec.model_dump(mode='json')
    if snapshot['saved'] and not snapshot['stale']:
        return {'status': 'confirmed', 'settings': settings}
    if isinstance(spec, LocalRehearsal):
        missing = [name for name in spec.engines if not engines.get(name)]
        if missing:
            return {'status': 'unavailable', 'settings': settings,
                    'notice': '双人排演缺少必需引擎：' + '、'.join(missing) + '。请在后端运行安装程序。'}
    if isinstance(spec, CastRehearsal) and not any(p.act or p.hold for p in spec.participants):
        return {'status': 'waiting', 'notice': '可在排演假设中填写人物的行动，也可以补充人物目标。', 'settings': settings}
    source = [namespace, snapshot['owner_card_id'], snapshot['scene_id'], snapshot['base_hash'], settings]
    key = hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    def cached():
        with _cache_lock:
            if key in _cache:
                saved_at, value = _cache[key]
                if value['status'] == 'unavailable' and monotonic() - saved_at >= 30:
                    del _cache[key]
                    return None
                _cache.move_to_end(key)
                return copy.deepcopy(value)
    result = cached()
    if result is None:
        if not compute:
            return {'status': 'pending', 'key': key, 'settings': settings}
        with _workers[int(key[:2], 16) % len(_workers)]:
            result = cached()
            if result is None:
                try:
                    computed = rehearse(snapshot['context'], spec)
                    result = {'status': 'ready', 'steps': computed['steps'], 'engines': computed['engines'],
                              'text': computed['text'], 'outcome': computed['outcome']}
                except (ValueError, OSError, ImportError) as exc:
                    logger.warning('Automatic scene rehearsal failed: %s', exc)
                    result = {'status': 'unavailable', 'notice': '本机排演暂未完成，可以查看引擎状态或调整假设。'}
                with _cache_lock:
                    _cache[key] = (monotonic(), copy.deepcopy(result))
                    if len(_cache) > 128:
                        _cache.popitem(last=False)
    return {**result, 'settings': settings, 'key': key}
