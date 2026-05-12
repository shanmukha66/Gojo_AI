import os
from datetime import datetime

import pandas as pd

BENE_PATH = os.getenv(
    "BENE_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/open/claimsdb/converted/bene_bene.csv",
)
INPATIENT_PATH = os.getenv(
    "INPATIENT_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/open/claimsdb/converted/inpatient_inpatient.csv",
)
OUTPATIENT_PATH = os.getenv(
    "OUTPATIENT_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/open/claimsdb/converted/outpatient_outpatient.csv",
)
OUT_PATH = os.getenv(
    "OUT_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/claimsdb_readmission.csv",
)


def parse_date(series):
    return pd.to_datetime(series, errors="coerce")


def main():
    bene = pd.read_csv(BENE_PATH)
    inpatient = pd.read_csv(INPATIENT_PATH)
    outpatient = pd.read_csv(OUTPATIENT_PATH)

    bene = bene.rename(columns={
        "DESYNPUF_ID": "patient_id",
        "BENE_BIRTH_DT": "birth_date",
        "BENE_SEX_IDENT_CD": "gender",
    })

    inpatient = inpatient.rename(columns={
        "DESYNPUF_ID": "patient_id",
        "CLM_ADMSN_DT": "admit_date",
        "NCH_BENE_DSCHRG_DT": "discharge_date",
    })

    outpatient = outpatient.rename(columns={
        "DESYNPUF_ID": "patient_id",
        "CLM_FROM_DT": "visit_start",
        "CLM_THRU_DT": "visit_end",
    })

    inpatient["admit_date"] = parse_date(inpatient["admit_date"])
    inpatient["discharge_date"] = parse_date(inpatient["discharge_date"])
    outpatient["visit_start"] = parse_date(outpatient["visit_start"])

    inpatient = inpatient.dropna(subset=["admit_date"])

    # compute readmission within 30 days using inpatient admissions per patient
    readmit_flags = []
    for pid, group in inpatient.sort_values("admit_date").groupby("patient_id"):
        dates = group["admit_date"].tolist()
        gaps = [(b - a).days for a, b in zip(dates[:-1], dates[1:])]
        readmitted = 1 if any(g <= 30 for g in gaps) else 0
        gap_seq = ",".join(str(g) for g in gaps) if gaps else ""
        date_seq = ",".join(d.strftime("%Y-%m-%d") for d in dates)
        readmit_flags.append({
            "patient_id": pid,
            "readmitted_30d": readmitted,
            "inpatient_visits": len(dates),
            "admit_dates": date_seq,
            "gap_days_seq": gap_seq,
        })

    readmit_df = pd.DataFrame(readmit_flags)

    outpatient_counts = (
        outpatient.groupby("patient_id")["visit_start"].count().reset_index().rename(columns={"visit_start": "outpatient_visits"})
    )

    # chronic condition flags from bene (SP_* columns)
    chronic_cols = [col for col in bene.columns if col.startswith("SP_")]
    for col in chronic_cols:
        bene[col] = pd.to_numeric(bene[col], errors="coerce").fillna(0)

    bene["chronic_condition_count"] = bene[chronic_cols].sum(axis=1)
    # condition prevalence (proxy for graph popularity)
    condition_prevalence = bene[chronic_cols].sum(axis=0)
    bene["condition_popularity_sum"] = (bene[chronic_cols] * condition_prevalence).sum(axis=1)
    bene["condition_popularity_mean"] = bene["condition_popularity_sum"] / (bene["chronic_condition_count"].replace(0, 1))

    # age
    today = datetime.now()
    bene["birth_date"] = parse_date(bene["birth_date"])
    bene["age"] = bene["birth_date"].apply(lambda d: max(0, today.year - d.year) if pd.notnull(d) else None)

    dataset = bene[[
        "patient_id",
        "age",
        "gender",
        "chronic_condition_count",
        "condition_popularity_sum",
        "condition_popularity_mean",
    ]].merge(
        readmit_df, on="patient_id", how="left"
    )
    dataset = dataset.merge(outpatient_counts, on="patient_id", how="left")

    dataset["readmitted_30d"] = dataset["readmitted_30d"].fillna(0).astype(int)
    dataset["inpatient_visits"] = dataset["inpatient_visits"].fillna(0).astype(int)
    dataset["outpatient_visits"] = dataset["outpatient_visits"].fillna(0).astype(int)
    dataset["gap_days_seq"] = dataset["gap_days_seq"].fillna("")
    dataset["admit_dates"] = dataset["admit_dates"].fillna("")

    dataset.to_csv(OUT_PATH, index=False)
    print(f"Wrote {OUT_PATH} with {len(dataset)} rows")


if __name__ == "__main__":
    main()
