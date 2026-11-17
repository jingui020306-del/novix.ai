#!/usr/bin/env bash
# Installs the full official pipeline into an isolated Linux/WSL CUDA environment.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cache=${NOVIX_CHIRON_HOME:-"$root/models/chiron"}
mkdir -p "$cache"
cache=$(cd "$cache" && pwd)
tag=chiron-weights-v1
repo=jingui020306-del/novix.ai
base="https://github.com/$repo/releases/download/$tag"
env_dir="$cache/env"
if [[ ! -x "$env_dir/bin/python" ]]; then
  conda create -y -p "$env_dir" python=3.11 pip
fi
"$env_dir/bin/python" -m pip install -r "$root/backend/rehearsal_engines/chiron/requirements.txt" \
  'vllm==0.6.3.post1' 'transformers==4.46.2' 'huggingface_hub>=0.26,<1' 'peft==0.13.2'
parts="$cache/download"
mkdir -p "$parts"
wheel=en_core_web_lg-3.7.1-py3-none-any.whl
if [[ "${1:-}" == "--from-hub" ]]; then
  "$env_dir/bin/python" -m pip install "https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.7.1/$wheel"
  "$env_dir/bin/python" "$root/scripts/chiron_weights.py" | tar -xf - -C "$cache"
else
  cd "$parts"
  curl -fsSL --retry 3 "$base/$wheel.sha256" -o "$wheel.sha256"
  if ! sha256sum --check --status "$wheel.sha256"; then
    curl -fL --retry 3 "$base/$wheel" -o "$wheel"
    sha256sum --check "$wheel.sha256"
  fi
  "$env_dir/bin/python" -m pip install "./$wheel"
  curl -fsSL --retry 3 "$base/SHA256SUMS" -o SHA256SUMS
  while read -r digest filename; do
    [[ "$filename" =~ ^chiron\.tar\.part-[0-9]{3}$ && "$digest" =~ ^[0-9a-f]{64}$ ]]
    if ! echo "$digest  $filename" | sha256sum --check --status; then
      curl -fL --retry 3 -C - "$base/$filename" -o "$filename" || curl -fL --retry 3 "$base/$filename" -o "$filename"
      if ! echo "$digest  $filename" | sha256sum --check --status; then
        rm -f "$filename"
        exit 1
      fi
    fi
  done < SHA256SUMS
  sha256sum --check SHA256SUMS
  awk '{print $2}' SHA256SUMS | xargs cat | tar -xf - -C "$cache"
fi
echo "CHIRON ready: $cache"
