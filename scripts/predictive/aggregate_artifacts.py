import json
import os
from datetime import datetime

OUT_DIR = "/Volumes/workspace/Explainable-AI-RAG-Framework/web/public/predictive"

METRICS_FILES = [
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_gnn.json",
]

CURVE_FILES = [
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_claimsdb_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_claimsdb_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_claimsdb_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/curves_gnn.json",
]

SUBGROUP_FILES = [
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_claimsdb_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_claimsdb_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_claimsdb_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/subgroup_gnn.json",
]

SHAP_FILES = [
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/shap_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/shap_claimsdb_tabular.json",
]


def load_files(paths):
    items = []
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                items.append(json.load(f))
    return items


def write_payload(name, items):
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, name)
    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "models": items,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {out_path} with {len(items)} entries")


def main():
    write_payload("metrics.json", load_files(METRICS_FILES))
    write_payload("curves.json", load_files(CURVE_FILES))
    write_payload("subgroups.json", load_files(SUBGROUP_FILES))
    write_payload("shap.json", load_files(SHAP_FILES))


if __name__ == "__main__":
    main()
