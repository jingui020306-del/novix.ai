"""Derive a local candidate when a scene is ready; only explicit confirmation saves a plan."""
import copy
import hashlib
import json
import logging
from collections import OrderedDict
from threading import Lock
from time import monotonic

from pydantic import ValidationError

from services.local_rehearsal import Choices, LocalRehearsal, rehearse, scene_cast

logger = logging.getLogger(__name__)
_cache = OrderedDict()
_cache_lock = Lock()
# A bounded set of locks coalesces concurrent polling and post-save work.
_workers = [Lock() for _ in range(32)]


def initial_spec(snapshot, engines):
    context = snapshot['context']
    cast = scene_cast(context)
    if len(cast) < 2:
        return None
    saved = snapshot['draft'].get('local_simulation')
    if isinstance(saved, dict):
        try:
            previous = LocalRehearsal.model_validate(saved)
        except ValidationError:
            previous = None
        if previous and previous.actor_id != previous.partner_id and previous.actor_id in cast and previous.partner_id in cast:
            return previous.model_copy(update={'engines': [k for k in previous.engines if engines.get(k)]})
    scene = context['scene']['values']
    # Use the order of an authored interaction when it identifies both participants.
    exchange = next((r['values'] for r in context['intersections']
                     if len(set(r['values'].get('characters') or []) & cast.keys()) >= 2), {})
    ordered = list(dict.fromkeys([*(exchange.get('characters') or []), *(scene.get('characters') or []),
                                  *(scene.get('cast') or []), *cast]))
    first, other = [key for key in ordered if key in cast][:2]
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
                          actor_confidence=0.7, partner_confidence=0.7, choices=choices,
                          engines=[key for key, ready in engines.items() if ready])


def candidate(namespace, snapshot, engines, *, compute):
    spec = initial_spec(snapshot, engines)
    if spec is None:
        return {'status': 'waiting', 'notice': '本场关联两位有效人物后，后端将自动排演。'}
    settings = spec.model_dump(mode='json')
    if snapshot['saved'] and not snapshot['stale']:
        return {'status': 'confirmed', 'settings': settings}
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
