import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
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
EPOCHS = int(os.getenv("EPOCHS", "8"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "64"))
MAX_LEN = int(os.getenv("MAX_LEN", "10"))
DATASET_LABEL = os.getenv("DATASET_LABEL", "synthea")
MODEL_LABEL = os.getenv("MODEL_LABEL", "sequence_gru")


torch.set_num_threads(MAX_WORKERS)


def temporal_split(df: pd.DataFrame, split: float = 0.8):
    df = df.copy()
    df["last_visit_date"] = pd.to_datetime(df["last_visit_date"], errors="coerce")
    df["sort_key"] = df["last_visit_date"].fillna(pd.Timestamp("1970-01-01")).astype(int)
    df = df.sort_values("sort_key")
    cutoff = int(len(df) * split)
    return df.iloc[:cutoff], df.iloc[cutoff:]


def parse_sequence(value: str):
    if not isinstance(value, str) or not value:
        return []
    return [v for v in value.split(",") if v]


class VisitDataset(Dataset):
    def __init__(self, sequences, labels):
        self.sequences = sequences
        self.labels = labels

    def __len__(self):
        return len(self.sequences)

    def __getitem__(self, idx):
        return torch.tensor(self.sequences[idx], dtype=torch.long), torch.tensor(self.labels[idx], dtype=torch.float32)


def pad_sequences(seqs, max_len):
    padded = []
    for seq in seqs:
        seq = seq[:max_len]
        if len(seq) < max_len:
            seq = seq + [0] * (max_len - len(seq))
        padded.append(seq)
    return padded


class GRUModel(nn.Module):
    def __init__(self, vocab_size: int, embed_dim: int = 32, hidden_dim: int = 64):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.gru = nn.GRU(embed_dim, hidden_dim, batch_first=True)
        self.out = nn.Linear(hidden_dim, 1)

    def forward(self, x):
        x = self.embedding(x)
        _, h = self.gru(x)
        logits = self.out(h[-1])
        return logits.squeeze(-1)


def evaluate(y_true, y_prob):
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
    df = df.dropna(subset=["readmitted_30d"]).copy()

    df["seq"] = df["visit_types"].apply(parse_sequence)

    vocab = {"PAD": 0}
    for seq in df["seq"]:
        for token in seq:
            if token not in vocab:
                vocab[token] = len(vocab)

    df["seq_ids"] = df["seq"].apply(lambda seq: [vocab[t] for t in seq])

    train_df, test_df = temporal_split(df)

    X_train = pad_sequences(train_df["seq_ids"].tolist(), MAX_LEN)
    y_train = train_df["readmitted_30d"].astype(int).tolist()

    X_test = pad_sequences(test_df["seq_ids"].tolist(), MAX_LEN)
    y_test = test_df["readmitted_30d"].astype(int).values

    train_loader = DataLoader(
        VisitDataset(X_train, y_train),
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=min(4, MAX_WORKERS),
    )

    model = GRUModel(vocab_size=len(vocab))
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.BCEWithLogitsLoss()

    model.train()
    for _ in range(EPOCHS):
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            logits = model(batch_x)
            loss = loss_fn(logits, batch_y)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        test_logits = model(torch.tensor(X_test, dtype=torch.long))
        y_prob = torch.sigmoid(test_logits).numpy()

    metrics = evaluate(y_test, y_prob)
    metrics.update({
        "dataset": DATASET_LABEL,
        "model": MODEL_LABEL,
        "train_size": int(len(train_df)),
        "test_size": int(len(test_df)),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })

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
    with open(os.path.join(OUT_DIR, "metrics_sequence.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    with open(os.path.join(OUT_DIR, "curves_sequence.json"), "w", encoding="utf-8") as f:
        json.dump(curves, f, indent=2)

    with open(os.path.join(OUT_DIR, "subgroup_sequence.json"), "w", encoding="utf-8") as f:
        json.dump(subgroups, f, indent=2)

    print("Saved sequence metrics, curves, and subgroup artifacts")


if __name__ == "__main__":
    main()
