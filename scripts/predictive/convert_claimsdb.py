import os
from pathlib import Path

import pyreadr

SOURCE_DIR = os.getenv(
    "SOURCE_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/open/claimsdb/data",
)
OUT_DIR = os.getenv(
    "OUT_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/open/claimsdb/converted",
)

os.makedirs(OUT_DIR, exist_ok=True)

for fname in os.listdir(SOURCE_DIR):
    if not fname.endswith(".rda"):
        continue
    fpath = os.path.join(SOURCE_DIR, fname)
    try:
        result = pyreadr.read_r(fpath)
    except Exception as exc:
        print(f"Skipping {fname}: {exc}")
        continue
    for key, df in result.items():
        out_name = f"{Path(fname).stem}_{key}.csv"
        out_path = os.path.join(OUT_DIR, out_name)
        df.to_csv(out_path, index=False)
        print(f"Wrote {out_path}")
