"""Local scene rehearsal. Only the visible consequence is passed to the next actor."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError, model_validator

from services import rehearsal_tools
from services.family_service import decision_bias


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Choices(BaseModel):
    model_config = ConfigDict(extra='forbid')
    act: ShortText
    hold: ShortText
    # A visible effect that enables the other actor's decision.
    effect: ShortText
    respond: ShortText
    check: ShortText

    @model_validator(mode='after')
    def distinct_actions(self):
        if self.act == self.hold or self.respond == self.check:
            raise ValueError('同一人物的两个选项需要能区分。')
        return self


class ChoiceStakes(BaseModel):
    model_config = ConfigDict(extra='forbid')
    goal_fit: Literal[-1, 0, 1] = 0
    stance: Literal[-1, 0, 1] = 0
    exposes_weakness: bool = False


class LocalRehearsal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['pair'] = Field(default='pair', exclude=True)
    version: Literal[1] = 1
    actor_id: ShortText
    partner_id: ShortText
    topic: ShortText
    available: bool
    actor_confidence: Probability
    partner_confidence: Probability
    actor_stakes: ChoiceStakes = Field(default_factory=ChoiceStakes)
    partner_stakes: ChoiceStakes = Field(default_factory=ChoiceStakes)
    actor_loss: Literal[2, 5, 8] = 5
    partner_loss: Literal[2, 5, 8] = 5
    choices: Choices
    engines: list[Literal['praxish', 'sabre', 'fatima']] = Field(default_factory=list, max_length=3)
    desirability: int = Field(default=0, ge=-10, le=10)
    plan_goal: Literal['respond', 'check'] = 'respond'


OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]


class Participant(BaseModel):
    model_config = ConfigDict(extra='forbid')
    actor_id: ShortText
    stakes: ChoiceStakes = Field(default_factory=ChoiceStakes)
    goal: OptionalText = ''
    act: OptionalText = ''
    hold: OptionalText = ''
    effect: OptionalText = ''
    visible_to: list[ShortText] | None = None
    available: bool = True
    confidence: Probability = 0.7
    loss: Literal[2, 5, 8] = 5


class CastRehearsal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['solo', 'ensemble']
    topic: OptionalText = ''
    participants: list[Participant] = Field(min_length=1)

    @model_validator(mode='after')
    def check_cast(self):
        count = len(self.participants)
        if self.mode == 'solo' and count != 1 or self.mode == 'ensemble' and count < 3:
            raise ValueError('单人排演请选择一位人物，群像排演至少需要三位。')
        cast = {p.actor_id for p in self.participants}
        if len(cast) != count:
            raise ValueError('每位人物在同一轮中只能出现一次。')
        if any(set(p.visible_to or []) - cast for p in self.participants):
            raise ValueError('行动后果只能对在场的人物可见。')
        return self


Simulation = LocalRehearsal | CastRehearsal
simulation_format = TypeAdapter(Simulation)


# These presets describe actions and their observable effect. Authors can edit all five.
PRESETS = {
    '交付物件': Choices(act='交出物件', hold='暂时保管', effect='对方已拿到物件',
                      respond='接手处理', check='先问清用途'),
    '透露消息': Choices(act='透露消息', hold='暂时保密', effect='对方已听到消息',
                      respond='据此采取行动', check='先核实来源'),
    '提出请求': Choices(act='当面提出请求', hold='暂缓开口', effect='对方已收到请求',
                      respond='当场答应', check='先商议条件'),
}


def choice_bonus(payload, stakes):
    # Action relevance is explicitly authored; free-text desires and secrets stay unparsed.
    exposure = 1.5 if stakes.exposes_weakness and payload.get('vulnerability') else 0.
    return 1.2 * stakes.goal_fit + 0.8 * stakes.stance - exposure


def _decide(available, confidence, loss, active, cautious, payload=None, stakes=None):
    payload = payload or {}
    bias = decision_bias(payload)
    bonus = choice_bonus(payload, stakes or ChoiceStakes())
    confidence = min(1., max(0., confidence + bias["confidence_delta"]))
    loss = min(12, max(1, loss + bias["loss_delta"]))
    from psychsim.agent import Agent
    from psychsim.probability import Distribution
    from psychsim.pwl import makeTree, setToConstantMatrix, trueRow
    from psychsim.reward import maximizeFeature
    from psychsim.world import World

    world = World()
    person = Agent('person')
    world.addAgent(person)
    opportunity = world.defineState(person.name, 'opportunity', bool)
    supported = world.defineState(person.name, 'support', bool)
    value = world.defineState(person.name, 'value', float, -16, 7)
    world.setFeature(opportunity, available)
    # Hypothetical support is used only in the actor's evaluation, never reported as a fact.
    world.setFeature(supported, True)
    world.setFeature(value, 0.)
    act = person.addAction({'verb': 'act'}, makeTree({'if': trueRow(opportunity), True: True, False: False}))
    hold = person.addAction({'verb': 'hold'})
    world.setDynamics(value, act, makeTree({'if': trueRow(supported),
                                            True: setToConstantMatrix(value, 3. + bonus),
                                            False: setToConstantMatrix(value, -float(loss) + bonus)}))
    world.setDynamics(value, hold, makeTree(setToConstantMatrix(value, -0.4)))
    world.setOrder([person.name])
    person.setReward(maximizeFeature(value, person.name), 1.)
    person.setHorizon(1)
    person.setBelief(supported, Distribution({True: confidence, False: 1 - confidence}))
    decision = person.decide(model=person.get_true_model(), selection='consistent')
    acts = decision['action'] == act
    return {'chosen': active if acts else cautious, 'acts': acts,
            'alternatives': [active, cautious] if available else [cautious],
            'expected_active': round(confidence * 3 - (1 - confidence) * loss + bonus, 3) if available else None,
            'expected_cautious': -0.4, 'character_bias': bias,
            'confidence_used': confidence, 'loss_used': loss, 'choice_bonus': bonus}


def scene_cast(context):
    linked = set(context['scene']['values'].get('characters') or [])
    linked.update(context['scene']['values'].get('cast') or [])
    for row in context['intersections'] + context['storylines']:
        values = row['values']
        linked.update(values.get('characters') or [])
        linked.add(values.get('character_id'))
    return {row['id']: row for row in context['characters'] if row['id'] in linked}


def participant_risks(saved):
    """Only carry the same actor's confidence and loss, never the scene's collective outcome."""
    if not saved.get('local_simulation'):
        return {}
    try:
        spec = simulation_format.validate_python(saved['local_simulation'])
    except ValidationError:
        return {}
    if isinstance(spec, CastRehearsal):
        return {p.actor_id: {'confidence': p.confidence, 'loss': p.loss} for p in spec.participants}
    return {spec.actor_id: {'confidence': spec.actor_confidence, 'loss': spec.actor_loss},
            spec.partner_id: {'confidence': spec.partner_confidence, 'loss': spec.partner_loss}}


def validate_cast(people, spec):
    if isinstance(spec, CastRehearsal):
        if {p.actor_id for p in spec.participants} != set(people):
            raise ValueError('参与人物与当前场景不一致，请核对本场出场人物。')
    elif spec.actor_id == spec.partner_id or any(key not in people for key in (spec.actor_id, spec.partner_id)):
        raise ValueError('请选择两位不同、在本场有有效资料的参与人物。')


def _cast_turns(people, spec):
    steps, text = [], []
    public_effect = (-1, '')
    private_effects = {}
    for index, part in enumerate(spec.participants):
        _, observed = max(public_effect, private_effects.get(part.actor_id, (-1, '')))
        person = people[part.actor_id]
        name = person['payload'].get('name') or person['label']
        # A later response needs an observable trigger. Private goals never enter this channel.
        can_act = part.available and bool(part.act) and (index == 0 or bool(observed))
        decision = _decide(can_act, part.confidence, part.loss, part.act, part.hold, person["payload"], part.stakes)
        decision['alternatives'] = [choice for choice in decision['alternatives'] if choice]
        visible = part.effect if decision['acts'] else ''
        steps.append({**decision, 'actor_id': part.actor_id, 'name': name, 'goal': part.goal,
                      'observed': observed, 'effect': visible})
        if decision['chosen']:
            prefix = f'在“{observed}”之后，' if observed else ''
            text.append(f'{prefix}{name}选择{decision["chosen"]}。')
        if visible:
            if part.visible_to is None:
                public_effect = (index, visible)
            else:
                for observer in part.visible_to:
                    private_effects[observer] = (index, visible)
    outcome = steps[-1]['effect']
    if not outcome:
        last_action = next((s for s in reversed(steps) if s['chosen']), None)
        outcome = f'{last_action["name"]}选择了{last_action["chosen"]}。' if last_action else ''
    return {'text': '\n'.join(text), 'outcome': outcome, 'steps': steps, 'engines': {}}


def rehearse(context, spec):
    people = scene_cast(context)
    validate_cast(people, spec)
    if isinstance(spec, CastRehearsal):
        return _cast_turns(people, spec)
    availability = rehearsal_tools.availability()
    for name in spec.engines:
        if not availability[name]:
            raise ValueError(f'{name} 尚未安装在后端主机，请查看本地引擎安装说明。')
    goals = {row['values'].get('character_id'): row['values'].get('goal') for row in context['storylines']}
    def turn(person_id, available, confidence, loss, act, hold, stakes):
        person = people[person_id]
        name = person['payload'].get('name') or person['label']
        return {**_decide(available, confidence, loss, act, hold, person["payload"], stakes), 'actor_id': person_id,
                'name': name, 'goal': goals.get(person_id) or person['payload'].get('core_motivation') or ''}
    choices = spec.choices
    reports = {}
    opportunity = spec.available
    if 'praxish' in spec.engines:
        reports['praxish'] = rehearsal_tools.social_actions(spec.available)
        opportunity = 'act' in reports['praxish']['first']
    first = turn(spec.actor_id, opportunity, spec.actor_confidence, spec.actor_loss, choices.act, choices.hold, spec.actor_stakes)
    steps = [first]
    witnessed = first['acts']
    if 'praxish' in reports:
        witnessed = 'respond' in reports['praxish']['after']['act' if first['acts'] else 'hold']
    partner_loss = spec.partner_loss
    if witnessed:
        if 'fatima' in spec.engines:
            emotion = rehearsal_tools.appraise(spec.desirability)
            # Novix policy: adverse mood increases the perceived cost, within a bounded range.
            partner_loss = max(1, min(12, partner_loss - float(emotion['mood']) / 2))
            reports['fatima'] = {**emotion, 'adjusted_loss': round(partner_loss, 2)}
        steps.append(turn(spec.partner_id, True, spec.partner_confidence, partner_loss, choices.respond, choices.check, spec.partner_stakes))
    if 'sabre' in spec.engines:
        actor_bias = decision_bias(people[spec.actor_id]['payload'])
        partner_bias = decision_bias(people[spec.partner_id]['payload'])
        evaluated = spec.model_copy(update={
            'actor_confidence': min(1., max(0., spec.actor_confidence + actor_bias['confidence_delta'])),
            'actor_loss': min(12, max(1, spec.actor_loss + actor_bias['loss_delta'])),
            'partner_confidence': min(1., max(0., spec.partner_confidence + partner_bias['confidence_delta'])),
        })
        reports['sabre'] = rehearsal_tools.plan(
            evaluated, min(12, max(1, partner_loss + partner_bias['loss_delta'])),
            choice_bonus(people[spec.actor_id]['payload'], spec.actor_stakes),
            choice_bonus(people[spec.partner_id]['payload'], spec.partner_stakes))
    text = [f'围绕“{spec.topic}”，{first["name"]}选择{first["chosen"]}。']
    if len(steps) == 2:
        second = steps[1]
        text.append(f'{choices.effect}。{second["name"]}选择{second["chosen"]}。')
        outcome = f'{choices.effect}。{second["name"]}选择了{second["chosen"]}。'
    else:
        outcome = f'{first["name"]}选择了{first["chosen"]}，尚未触发对方的回应。'
    return {'text': '\n'.join(text), 'outcome': outcome, 'steps': steps, 'engines': reports}
