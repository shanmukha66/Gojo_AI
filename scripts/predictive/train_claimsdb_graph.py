import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, precision_recall_curve, roc_auc_score, roc_curve
from xgboost import XGBClassifier

DATA_PATH = os.getenv(
    "DATA_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/claimsdb_readmission.csv",
)
OUT_DIR = os.getenv(
    "OUT_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive",
)
MAX_WORKERS = int(os.getenv("MAX_WORKERS", str(os.cpu_count() or 4)))
DATASET_LABEL = os.getenv("DATASET_LABEL", "claimsdb")
MODEL_LABEL = os.getenv("MODEL_LABEL", "claimsdb_graph_xgboost")


from sklearn.model_selection import train_test_split

def temporal_split(df: pd.DataFrame, split: float = 0.8):
    train_df, test_df = train_test_split(df, test_size=1 - split, random_state=42, stratify=df["readmitted_30d"])
    return train_df, test_df


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
    df = df.dropna(subset=["readmitted_30d"]).copy()

    feature_cols = [
        "age",
        "chronic_condition_count",
        "condition_popularity_sum",
        "condition_popularity_mean",
        "inpatient_visits",
        "outpatient_visits",
    ]

    train_df, test_df = temporal_split(df)

    X_train = train_df[feature_cols].fillna(0)
    y_train = train_df["readmitted_30d"].astype(int)

    X_test = test_df[feature_cols].fillna(0)
    y_test = test_df["readmitted_30d"].astype(int)

    pos = max(int(y_train.sum()), 1)
    neg = max(int(len(y_train) - y_train.sum()), 1)
    scale_pos_weight = neg / pos

    model = XGBClassifier(
        n_estimators=350,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        eval_metric="logloss",
        n_jobs=MAX_WORKERS,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
    )

    model.fit(X_train, y_train)
    y_prob = model.predict_proba(X_test)[:, 1]

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
    with open(os.path.join(OUT_DIR, "metrics_claimsdb_graph.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    with open(os.path.join(OUT_DIR, "curves_claimsdb_graph.json"), "w", encoding="utf-8") as f:
        json.dump(curves, f, indent=2)

    with open(os.path.join(OUT_DIR, "subgroup_claimsdb_graph.json"), "w", encoding="utf-8") as f:
        json.dump(subgroups, f, indent=2)

    print("Saved ClaimsDB graph metrics, curves, and subgroup artifacts")


if __name__ == "__main__":
    main()
