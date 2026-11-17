"""Choose one loopback model for both manuscript and outline pacing analysis."""
import os
from urllib.parse import urlsplit

OLLAMA_URL = 'http://127.0.0.1:11434'
PACING_MODEL = 'qwen2.5:7b'


def pacing_profile():
    url = os.environ.get('NOVIX_PACING_MODEL_URL')
    if not url:
        return {'provider': 'ollama', 'base_url': OLLAMA_URL, 'model': PACING_MODEL,
                'timeout_s': 600, 'local_only': True, 'stream': False}
    endpoint = urlsplit(url)
    if endpoint.scheme not in ('http', 'https') or endpoint.hostname not in ('127.0.0.1', '::1', 'localhost') or endpoint.username is not None:
        raise ValueError('节奏分析需要本机模型地址。')
    from services.local_model_service import model_spec
    spec = model_spec('pacing')
    return {'provider': 'llama_cpp', 'base_url': url.rstrip('/'), 'model': spec['id'],
            'revision': spec['revision'], 'local_only': True, 'stream': False, 'timeout_s': 600}
