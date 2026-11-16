"""Install the pinned local rehearsal engines. Run this file from the project root."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.request import urlopen

from runtime import FATIMA, HERE, SABRE, engine_dir, fatima_dll, sabre_jar


def install_sabre(staging):
    url = f'https://raw.githubusercontent.com/sgware/sabre/{SABRE}/build/jar/sabre.jar'
    with urlopen(url, timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != 'b87354bc90d17de935fcb5ba4b091cc9d7c52a6c46fdceb35f71b6832a26a4e3':
        raise RuntimeError('Sabre 文件校验失败。')
    (staging / 'sabre.jar').write_bytes(data)


def install_fatima(staging, work):
    source = work / 'toolkit'
    source.mkdir()
    subprocess.run(['git', 'init', '--quiet'], cwd=source, check=True)
    subprocess.run(['git', 'fetch', '--quiet', '--depth=1', 'https://github.com/GAIPS/FAtiMA-Toolkit.git', FATIMA], cwd=source, check=True)
    subprocess.run(['git', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], cwd=source, check=True)
    bridge = work / 'bridge'
    bridge.mkdir()
    for file in ('Appraisal.csproj', 'Program.cs'):
        shutil.copy(HERE / 'fatima' / file, bridge)
    subprocess.run(['dotnet', 'publish', str(bridge / 'Appraisal.csproj'), '-c', 'Release', '-m:1', '-p:BuildInParallel=false',
                    '-p:UseSharedCompilation=false', '-p:RestoreSources=https://api.nuget.org/v3/index.json',
                    f'-p:FatimaSource={source}', '-o', str(staging)], check=True)
    shutil.copy(source / 'License.txt', staging / 'FAtiMA-License.txt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('engines', choices=['sabre', 'fatima', 'all'], nargs='?', default='all')
    choice = parser.parse_args().engines
    root = engine_dir()
    root.mkdir(parents=True, exist_ok=True)
    for name, target in [('sabre', sabre_jar()), ('fatima', fatima_dll())]:
        if choice not in ('all', name) or target.is_file():
            continue
        with tempfile.TemporaryDirectory(dir=root) as temp:
            work = Path(temp)
            staging = work / 'build'
            staging.mkdir()
            if name == 'sabre':
                install_sabre(staging)
            else:
                install_fatima(staging, work)
            try:
                staging.rename(target.parent)
            except OSError:
                if not target.is_file():
                    raise
        print('Installed', name, target)
