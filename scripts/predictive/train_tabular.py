import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier

DATA_PATH = os.getenv(
    "DATA_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/readmission_dataset.csv",
)
OUT_DIR = os.getenv(
    "OUT_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive",
)
MAX_WORKERS = int(os.getenv("MAX_WORKERS", str(os.cpu_count() or 4)))
DATASET_LABEL = os.getenv("DATASET_LABEL", "synthea")
MODEL_LABEL = os.getenv("MODEL_LABEL", "tabular_xgboost")


def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df["last_visit_date"] = pd.to_datetime(df["last_visit_date"], errors="coerce")
    df["first_visit_date"] = pd.to_datetime(df["first_visit_date"], errors="coerce")
    return df


def temporal_split(df: pd.DataFrame, split: float = 0.8):
    df = df.copy()
    df["sort_key"] = df["last_visit_date"].fillna(pd.Timestamp("1970-01-01")).astype(int)
    df = df.sort_values("sort_key")
    cutoff = int(len(df) * split)
    return df.iloc[:cutoff], df.iloc[cutoff:]


def build_preprocessor():
    categorical = ["gender"]
    numeric = [
        "age",
        "risk",
        "visit_count",
        "condition_count",
        "avg_days_between_visits",
        "min_days_between_visits",
        "recent_visit_gap_days",
    ]

    pre = ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical),
            ("num", "passthrough", numeric),
        ]
    )

    return pre, numeric + categorical


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


def compute_shap(pipeline: Pipeline, X_sample: pd.DataFrame):
    try:
        import shap
    except Exception:
        return None

    model = pipeline.named_steps["model"]
    pre = pipeline.named_steps["pre"]

    feature_names = pre.get_feature_names_out()
    X_transformed = pre.transform(X_sample)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_transformed)

    if isinstance(shap_values, list):
        shap_values = shap_values[1] if len(shap_values) > 1 else shap_values[0]
    elif isinstance(shap_values, np.ndarray) and shap_values.ndim == 3:
        shap_values = shap_values[:, :, 1]

    mean_abs = np.abs(shap_values).mean(axis=0)
    if isinstance(mean_abs, np.ndarray) and mean_abs.ndim > 1:
        mean_abs = mean_abs.mean(axis=-1)

    top_idx = np.argsort(mean_abs)[::-1][:12]

    features = []
    for idx in top_idx:
        features.append({
            "name": feature_names[idx],
            "importance": float(mean_abs[idx]),
        })

    return features


def main():
    df = load_data()
    df = df.dropna(subset=["readmitted_30d"]).copy()

    train_df, test_df = temporal_split(df)

    pre, feature_cols = build_preprocessor()

    X_train = train_df[feature_cols]
    y_train = train_df["readmitted_30d"].astype(int)

    X_test = test_df[feature_cols]
    y_test = test_df["readmitted_30d"].astype(int)

    pos = max(int(y_train.sum()), 1)
    neg = max(int(len(y_train) - y_train.sum()), 1)
    scale_pos_weight = neg / pos

    model = XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        eval_metric="logloss",
        n_jobs=MAX_WORKERS,
        scale_pos_weight=scale_pos_weight,
        random_state=42,
    )

    pipeline = Pipeline([("pre", pre), ("model", model)])
    pipeline.fit(X_train, y_train)
    y_prob = pipeline.predict_proba(X_test)[:, 1]

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

    shap_features = compute_shap(pipeline, X_test.sample(n=min(200, len(X_test)), random_state=42))

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "metrics_tabular.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    with open(os.path.join(OUT_DIR, "curves_tabular.json"), "w", encoding="utf-8") as f:
        json.dump(curves, f, indent=2)

    with open(os.path.join(OUT_DIR, "subgroup_tabular.json"), "w", encoding="utf-8") as f:
        json.dump(subgroups, f, indent=2)

    if shap_features:
        with open(os.path.join(OUT_DIR, "shap_tabular.json"), "w", encoding="utf-8") as f:
            json.dump({"dataset": DATASET_LABEL, "model": MODEL_LABEL, "features": shap_features}, f, indent=2)

    print("Saved tabular metrics, curves, subgroup, and SHAP artifacts")


if __name__ == "__main__":
    main()
