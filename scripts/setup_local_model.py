"""Install the model pinned in models/default.json."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from services.local_model_service import install_model

if __name__ == '__main__':
    install_model()
    install_model("pacing")
