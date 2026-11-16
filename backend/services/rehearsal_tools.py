"""Adapters only. All inputs to external programs use bounded numbers and fixed symbols."""
import json
from pathlib import Path
import subprocess
import tempfile

from rehearsal_engines.runtime import HERE, availability, fatima_dll, sabre_jar


def run_engine(name, command, payload=None):
    try:
        result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                capture_output=True, text=True, encoding='utf-8', timeout=10, check=True)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError(f'{name} 未完成，请检查本机引擎安装后重试。') from exc
    return result.stdout.strip()


def social_actions(available):
    return json.loads(run_engine('Praxish', ['node', str(HERE / 'practice.cjs')], {'available': available}))


def appraise(desirability):
    return json.loads(run_engine('FAtiMA', ['dotnet', str(fatima_dll())], {'desirability': desirability}))


def plan(spec, partner_loss):
    # Numeric author/character utilities are independent. A plan may be unreachable.
    def gain(probability, loss):
        return round(3 * probability - loss * (1 - probability) + 0.4, 6)

    goal = {'respond': 'answered()', 'check': 'checked()'}[spec.plan_goal]
    problem = f'''
entity First : character;
entity Other : character;
property ready() : boolean;
property offered() : boolean;
property answered() : boolean;
property checked() : boolean;
{"ready();" if spec.available else ""}
action initiate() {{
  precondition: ready() & !offered();
  effect: offered();
  consenting: First;
  observing(c : character): True;
}};
action respond() {{
  precondition: offered() & !answered() & !checked();
  effect: answered();
  consenting: Other;
  observing(c : character): True;
}};
action check() {{
  precondition: offered() & !answered() & !checked();
  effect: checked();
  consenting: Other;
  observing(c : character): True;
}};
utility(): {goal};
utility(First): if(offered()) {gain(spec.actor_confidence, spec.actor_loss)} else 0;
utility(Other): if(checked()) 0.1 elseif(answered()) {gain(spec.partner_confidence, partner_loss)} else 0;
'''
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'scene.txt'
        path.write_text(problem, encoding='ascii')
        output = run_engine('Sabre', ['java', '-Xmx128m', '-jar', str(sabre_jar()), '-p', str(path)])
    if output.startswith('No solution'):
        return []
    labels = {'initiate()': spec.choices.act, 'respond()': spec.choices.respond, 'check()': spec.choices.check}
    tokens = output.split()
    if not tokens or any(token not in labels for token in tokens):
        raise ValueError('Sabre 未返回可识别的计划，请检查引擎版本。')
    return [labels[token] for token in tokens]
