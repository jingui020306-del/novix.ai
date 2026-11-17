"""Build the Novix Conda environment and prepare the app for local use."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TIKA_VERSION = '3.3.3'
TIKA_SHA256 = 'f29d4e0d2cff1fc32396f6ac5ce436dfc7b19f9303d3b899e1f56fde85711c96'


def install_word_reader():
    target = Path(sys.prefix) / 'share' / 'novix' / 'tika-app.jar'
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        with target.open('rb') as existing:
            if hashlib.file_digest(existing, 'sha256').hexdigest() == TIKA_SHA256:
                return
    url = f'https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/{TIKA_VERSION}/tika-app-{TIKA_VERSION}.jar'
    with TemporaryDirectory(dir=target.parent) as temp:
        jar = Path(temp) / 'tika-app.jar'
        with urlopen(url, timeout=120) as response, jar.open('wb') as out:
            shutil.copyfileobj(response, out)
        with jar.open('rb') as saved:
            if hashlib.file_digest(saved, 'sha256').hexdigest() != TIKA_SHA256:
                raise ValueError('旧版 Word 读取组件校验失败，请重新运行安装命令。')
        jar.replace(target)


def prepare_app():
    frontend = ROOT / 'frontend'
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    subprocess.run([npm, 'install',
                    '--no-audit', '--no-fund'], cwd=frontend, check=True)
    subprocess.run([npm, 'run', 'build:static'], cwd=frontend, check=True)
    install_word_reader()
    subprocess.run([sys.executable, ROOT / 'backend/rehearsal_engines/install.py'], cwd=ROOT, check=True)


def main():
    conda = os.environ.get('CONDA_EXE') or shutil.which('conda')
    # Miniconda may append its defaults channel even for a nodefaults environment.
    channels = {**os.environ, 'CONDA_CHANNELS': 'conda-forge',
                'CONDA_DEFAULT_CHANNELS': 'https://conda.anaconda.org/conda-forge'}
    subprocess.run([conda, 'env', 'update', '-n', 'novix', '-f', 'environment.yml'],
                   cwd=ROOT, env=channels, check=True)
    subprocess.run([conda, 'run', '--no-capture-output', '-n', 'novix',
                    'python', 'scripts/setup_env.py', '--prepare'], cwd=ROOT, check=True)
    print('Novix 已就绪。启动命令：conda run --no-capture-output -n novix python start.py --prod')


if __name__ == '__main__':
    if sys.argv[1:] == ['--prepare']:
        prepare_app()
    else:
        main()
