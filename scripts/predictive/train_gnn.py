import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
import torch
from neo4j import GraphDatabase
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, precision_recall_curve, roc_auc_score, roc_curve

DATA_PATH = os.getenv(
    "DATA_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/readmission_dataset.csv",
)
OUT_DIR = os.getenv(
    "OUT_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive",
)
MAX_WORKERS = int(os.getenv("MAX_WORKERS", str(os.cpu_count() or 4)))
EPOCHS = int(os.getenv("EPOCHS", "20"))
LR = float(os.getenv("LR", "0.01"))
DATASET_LABEL = os.getenv("DATASET_LABEL", "synthea")
MODEL_LABEL = os.getenv("MODEL_LABEL", "gnn_gcn")

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")


torch.set_num_threads(MAX_WORKERS)


def temporal_split(df: pd.DataFrame, split: float = 0.8):
    df = df.copy()
    df["last_visit_date"] = pd.to_datetime(df["last_visit_date"], errors="coerce")
    df["sort_key"] = df["last_visit_date"].fillna(pd.Timestamp("1970-01-01")).astype(int)
    df = df.sort_values("sort_key")
    cutoff = int(len(df) * split)
    return df.iloc[:cutoff], df.iloc[cutoff:]


def fetch_edges():
    query = """
    MATCH (p:Patient)-[:HAS_CONDITION]->(c:Condition)
    RETURN p.id AS patient_id, c.code AS condition_code
    """
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    with driver.session() as session:
        rows = session.run(query)
        return [row.data() for row in rows]


def normalize_adj(indices, values, num_nodes):
    row, col = indices
    deg = torch.zeros(num_nodes, dtype=torch.float32)
    deg.index_add_(0, row, values)
    deg.index_add_(0, col, values)
    deg = torch.clamp(deg, min=1.0)
    deg_inv_sqrt = torch.pow(deg, -0.5)
    norm_values = deg_inv_sqrt[row] * values * deg_inv_sqrt[col]
    return torch.sparse_coo_tensor(indices, norm_values, (num_nodes, num_nodes))


def evaluate(y_true, y_prob):
    y_true = np.asarray(y_true)
    if len(np.unique(y_true)) < 2:
        return {"roc_auc": None, "pr_auc": None, "f1": None, "brier": None}
    y_pred = (y_prob >= 0.5).astype(int)
    return {
        "roc_auc": roc_auc_score(y_true, y_prob),
        "pr_auc": average_precision_score(y_true, y_prob),
        "f1": f1_score(y_true, y_pred),
        "brier": brier_score_loss(y_true, y_prob),
    }


def compute_subgroups(test_df: pd.DataFrame, y_prob: np.ndarray):
    groups = []
    test_df = test_df.copy()
    test_df["y_prob"] = y_prob
    test_df["y_true"] = test_df["readmitted_30d"].astype(int)

    age_bins = [0, 39, 64, 120]
    age_labels = ["0-39", "40-64", "65+"]
    test_df["age_band"] = pd.cut(test_df["age"], bins=age_bins, labels=age_labels, include_lowest=True)

    for label, subset in test_df.groupby("age_band", dropna=True):
        if subset.empty:
            continue
        groups.append({
            "group": f"age_{label}",
            "support": int(len(subset)),
            **evaluate(subset["y_true"], subset["y_prob"]),
        })

    if "gender" in test_df.columns:
        for label, subset in test_df.groupby("gender", dropna=True):
            if subset.empty:
                continue
            groups.append({
                "group": f"gender_{label}",
                "support": int(len(subset)),
                **evaluate(subset["y_true"], subset["y_prob"]),
            })

    return groups


def main():
    df = pd.read_csv(DATA_PATH)
    df["patient_id"] = df["patient_id"].astype(str)
    df = df.dropna(subset=["readmitted_30d"]).copy()

    patient_ids = df["patient_id"].unique().tolist()
    edges = fetch_edges()
    condition_codes = sorted({str(e["condition_code"]) for e in edges if e["condition_code"] is not None})

    patient_index = {pid: idx for idx, pid in enumerate(patient_ids)}
    condition_index = {code: idx + len(patient_ids) for idx, code in enumerate(condition_codes)}
    num_nodes = len(patient_ids) + len(condition_codes)

    patient_features = df.set_index("patient_id")[[
        "age",
        "risk",
        "visit_count",
        "condition_count",
        "avg_days_between_visits",
        "recent_visit_gap_days",
    ]].fillna(0.0).values

    condition_degrees = np.zeros(len(condition_codes), dtype=np.float32)
    for edge in edges:
        code = edge["condition_code"]
        if code is None:
            continue
        condition_degrees[condition_codes.index(str(code))] += 1

    condition_features = np.zeros((len(condition_codes), patient_features.shape[1]), dtype=np.float32)
    if condition_features.shape[1] > 0:
        condition_features[:, -1] = condition_degrees

    features = np.vstack([patient_features, condition_features])

    rows = []
    cols = []
    for edge in edges:
        pid = edge["patient_id"]
        code = edge["condition_code"]
        if pid is None or code is None:
            continue
        if pid not in patient_index or str(code) not in condition_index:
            continue
        p_idx = patient_index[pid]
        c_idx = condition_index[str(code)]
        rows.append(p_idx)
        cols.append(c_idx)
        rows.append(c_idx)
        cols.append(p_idx)

    for i in range(num_nodes):
        rows.append(i)
        cols.append(i)

    indices = torch.tensor([rows, cols], dtype=torch.long)
    values = torch.ones(len(rows), dtype=torch.float32)
    adj = normalize_adj(indices, values, num_nodes)

    X = torch.tensor(features, dtype=torch.float32)

    train_df, test_df = temporal_split(df)
    train_ids = train_df["patient_id"].tolist()
    test_ids = test_df["patient_id"].tolist()

    train_idx = torch.tensor([patient_index[pid] for pid in train_ids], dtype=torch.long)
    test_idx = torch.tensor([patient_index[pid] for pid in test_ids], dtype=torch.long)

    y = torch.tensor(df.set_index("patient_id")["readmitted_30d"].astype(int).values, dtype=torch.float32)

    class GCN(torch.nn.Module):
        def __init__(self, in_dim, hidden_dim=32):
            super().__init__()
            self.w1 = torch.nn.Linear(in_dim, hidden_dim)
            self.w2 = torch.nn.Linear(hidden_dim, 1)

        def forward(self, x, adj_mat):
            h = torch.sparse.mm(adj_mat, x)
            h = torch.relu(self.w1(h))
            h = torch.sparse.mm(adj_mat, h)
            out = self.w2(h).squeeze(-1)
            return out

    model = GCN(X.shape[1])
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    loss_fn = torch.nn.BCEWithLogitsLoss()

    model.train()
    for _ in range(EPOCHS):
        optimizer.zero_grad()
        logits = model(X, adj)
        loss = loss_fn(logits[train_idx], y[train_idx])
        loss.backward()
        optimizer.step()

    model.eval()
    with torch.no_grad():
        logits = model(X, adj)
        probs = torch.sigmoid(logits).numpy()

    y_test = y[test_idx].numpy()
    y_prob = probs[test_idx.numpy()]

    metrics = evaluate(y_test, y_prob)
    metrics.update({
        "dataset": DATASET_LABEL,
        "model": MODEL_LABEL,
        "train_size": int(len(train_df)),
        "test_size": int(len(test_df)),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })

    if len(np.unique(y_test)) < 2:
        fpr, tpr, prec, rec = [], [], [], []
    else:
        fpr, tpr, _ = roc_curve(y_test, y_prob)
        prec, rec, _ = precision_recall_curve(y_test, y_prob)

    curves = {
        "dataset": DATASET_LABEL,
        "model": MODEL_LABEL,
        "roc": [{"fpr": float(a), "tpr": float(b)} for a, b in zip(fpr, tpr)],
        "pr": [{"recall": float(r), "precision": float(p)} for r, p in zip(rec, prec)],
    }

    subgroups = {
        "dataset": DATASET_LABEL,
        "model": MODEL_LABEL,
        "groups": compute_subgroups(test_df, y_prob),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "metrics_gnn.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    with open(os.path.join(OUT_DIR, "curves_gnn.json"), "w", encoding="utf-8") as f:
        json.dump(curves, f, indent=2)

    with open(os.path.join(OUT_DIR, "subgroup_gnn.json"), "w", encoding="utf-8") as f:
        json.dump(subgroups, f, indent=2)

    print("Saved GNN metrics, curves, and subgroup artifacts")


if __name__ == "__main__":
    main()
