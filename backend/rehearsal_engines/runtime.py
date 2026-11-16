from functools import lru_cache
import os
import re
import subprocess
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
SABRE = '73a128123b10a57843068b69d0b0e0601f37488a'
FATIMA = '56b7cbd992f953cfe21a7b12cb1a0e6cdf6ccf9f'


def engine_dir():
    return Path(os.environ.get('NOVIX_ENGINE_DIR') or Path.home() / '.novix' / 'engines')


def sabre_jar():
    return engine_dir() / ('sabre-' + SABRE) / 'sabre.jar'


def fatima_dll():
    return engine_dir() / ('fatima-' + FATIMA + '-v1') / 'Appraisal.dll'


@lru_cache(maxsize=16)
def compatible(executable, path):
    if not path:
        return False
    argument = {'java': '-version', 'node': '--version', 'dotnet': '--list-runtimes'}[executable]
    try:
        result = subprocess.run([path, argument], capture_output=True, text=True, timeout=4, check=True)
    except (OSError, subprocess.SubprocessError):
        return False
    version = result.stdout + result.stderr
    if executable == 'dotnet':
        return any(line.startswith('Microsoft.NETCore.App 8.') for line in version.splitlines())
    pattern = r'version "(\d+)' if executable == 'java' else r'^v(\d+)'
    match = re.search(pattern, version)
    return bool(match and int(match[1]) >= (21 if executable == 'java' else 20))


def availability():
    return {'praxish': compatible('node', shutil.which('node')),
            'sabre': sabre_jar().is_file() and compatible('java', shutil.which('java')),
            'fatima': fatima_dll().is_file() and compatible('dotnet', shutil.which('dotnet'))}
