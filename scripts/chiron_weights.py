"""Stream the official CHIRON checkpoints as an offline Hugging Face cache."""
import hashlib
import io
import sys
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory

from huggingface_hub import HfApi, hf_hub_download

REPOSITORIES = (
    "mistralai/Mistral-7B-Instruct-v0.2",
    "agurung/character_sheet_entailment_model___mistral7bv2",
)


def checkpoint_files(info):
    files = [item for item in info.siblings if "/" not in item.rfilename]
    suffix = ".safetensors" if any(item.rfilename.endswith(".safetensors") for item in files) else ".bin"
    selected = [item for item in files if item.rfilename.endswith((suffix, ".json", ".model", ".txt", ".md"))
                or item.rfilename.upper().startswith(("LICENSE", "NOTICE"))]
    if not any(item.rfilename.endswith(suffix) for item in selected):
        raise ValueError(f"No checkpoint weights found in {info.id}@{info.sha}")
    return selected


def pack(output):
    api = HfApi()
    models = [(info, checkpoint_files(info)) for info in
              (api.model_info(repo, files_metadata=True) for repo in REPOSITORIES)]
    with tarfile.open(fileobj=output, mode="w|") as archive:
        for info, files in models:
            root = "models--" + info.id.replace("/", "--")
            for item in files:
                print(f"{info.id}@{info.sha}: {item.rfilename}", file=sys.stderr, flush=True)
                # A hosted runner only needs space for one upstream file at a time.
                with TemporaryDirectory() as cache:
                    path = Path(hf_hub_download(info.id, item.rfilename, revision=info.sha, local_dir=cache))
                    if path.stat().st_size != item.size:
                        raise ValueError(f"Incomplete download: {item.rfilename}")
                    with path.open("rb") as handle:
                        if item.lfs and hashlib.file_digest(handle, "sha256").hexdigest() != item.lfs.sha256:
                            raise ValueError(f"Checksum mismatch: {item.rfilename}")
                    archive.add(path, f"{root}/snapshots/{info.sha}/{item.rfilename}", recursive=False)
            ref = tarfile.TarInfo(f"{root}/refs/main")
            revision = info.sha.encode("ascii")
            ref.size = len(revision)
            archive.addfile(ref, io.BytesIO(revision))


if __name__ == "__main__":
    pack(sys.stdout.buffer)
