"""Install the pinned local rehearsal engines. Run this file from the project root."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener, urlopen

from pacing_model import OLLAMA_URL, PACING_MODEL
from runtime import FATIMA, HERE, SABRE, availability, engine_dir, fatima_dll, sabre_jar


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


def install_pacing():
    local = build_opener(ProxyHandler({}))
    def request(action):
        payload = json.dumps({'model': PACING_MODEL, 'stream': False}).encode()
        return Request(f'{OLLAMA_URL}/api/{action}', payload, {'Content-Type': 'application/json'})
    try:
        with local.open(request('show'), timeout=20):
            return
    except HTTPError as exc:
        if exc.code != 404:
            raise
    print(f'正在安装本地模型 {PACING_MODEL}…', flush=True)
    with local.open(request('pull'), timeout=3600) as response:
        if json.load(response).get('status') != 'success':
            raise RuntimeError('Ollama 未完成模型安装。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('engines', choices=['sabre', 'fatima', 'pacing', 'all'], nargs='?', default='all')
    choice = parser.parse_args().engines
    if choice in ('all', 'fatima') and not shutil.which('dotnet'):
        sys.exit('本地组件未就绪：请先安装 .NET 8 SDK，再运行安装程序。')
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
    if choice == 'all':
        missing = [name for name, ready in availability().items() if not ready]
        if missing:
            sys.exit('未就绪的必需排演组件：' + '、'.join(missing) + '。请检查 Node 20+、Java 21+、.NET 8。')
    if choice in ('pacing', 'all'):
        try:
            install_pacing()
        except (OSError, RuntimeError, ValueError) as exc:
            sys.exit(f'节奏模型安装失败。请先启动本机 Ollama 后重试：{exc}')
