# -*- coding: utf-8 -*-
"""
价格异常检测
优先用 7 天滑动窗口 + 2σ 阈值；
当数据只有一天（rolling_std 全为 0）时，切换到整体分布检测。
"""

import json
import math
from pathlib import Path
from datetime import datetime

import pandas as pd
import numpy as np

BASE_DIR = Path(__file__).resolve().parents[2]
PROCESSED_DIR = BASE_DIR / "data" / "processed"
OUTPUT_DIR = BASE_DIR / "data" / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

THRESHOLD_SIGMA = 2.0       # 滚动窗口阈值
GLOBAL_SIGMA = 1.5          # 兜底：整体分布阈值


def clean_nan(obj):
    """递归清理 NaN / Infinity，转为 None"""
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    if isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def detect_rolling(df: pd.DataFrame) -> pd.DataFrame:
    """滚动窗口 + 2σ 检测"""
    df = df.copy()
    df["rolling_std"] = df["rolling_std"].fillna(0)
    upper = df["rolling_mean"] + THRESHOLD_SIGMA * df["rolling_std"]
    lower = df["rolling_mean"] - THRESHOLD_SIGMA * df["rolling_std"]
    mask = (df["rolling_std"] > 0) & ((df["price"] > upper) | (df["price"] < lower))
    return df[mask].copy()


def detect_global(df: pd.DataFrame) -> pd.DataFrame:
    """兜底：按品类分组，用组内均值和标准差检测"""
    df = df.copy()
    if "category" not in df.columns or df["category"].isna().all():
        df["category"] = "all"

    results = []
    for cat, group in df.groupby("category"):
        # 样本量少于 5 的品类跳过，避免标准差无意义
        if len(group) < 5:
            continue

        mu = group["price"].mean()
        sigma = group["price"].std()
        if pd.isna(sigma) or sigma == 0:
            continue

        upper = mu + GLOBAL_SIGMA * sigma
        lower = mu - GLOBAL_SIGMA * sigma
        mask = (group["price"] > upper) | (group["price"] < lower)
        sub = group[mask].copy()

        sub["global_mean"] = mu
        sub["global_std"] = sigma
        sub["rolling_mean"] = sub["rolling_mean"].fillna(mu)
        sub["rolling_std"] = sub["rolling_std"].fillna(sigma)
        sub["price_change_pct"] = ((sub["price"] - mu) / mu * 100).round(1)
        results.append(sub)

    if not results:
        return df.iloc[0:0].copy()
    return pd.concat(results)


def build_anomaly_records(df: pd.DataFrame, sigma: float) -> list:
    """转换成输出格式"""
    records = []
    for _, row in df.iterrows():
        rolling_mean = row.get("rolling_mean")
        if pd.isna(rolling_mean):
            rolling_mean = row.get("global_mean", row["price"])
        rolling_std = row.get("rolling_std")
        if pd.isna(rolling_std):
            rolling_std = row.get("global_std", 0)

        records.append({
            "asin": str(row["asin"]),
            "title": str(row.get("title", ""))[:80],
            "date": str(row["date"]),
            "old_price": round(float(rolling_mean), 2),
            "new_price": round(float(row["price"]), 2),
            "change_pct": round(float(row.get("price_change_pct", 0) or 0), 1),
            "threshold": round(float(sigma * rolling_std), 2),
            "alert": True,
        })
    records.sort(key=lambda x: abs(x["change_pct"]), reverse=True)
    return records


def update_kpi(anomalies: list):
    """同步更新 micro_kpi.json"""
    kpi_path = PROCESSED_DIR / "micro_kpi.json"
    if not kpi_path.exists():
        print(f"[警告] {kpi_path} 不存在，跳过 KPI 更新")
        return

    with open(kpi_path, "r", encoding="utf-8") as f:
        kpi = json.load(f)

    kpi["anomalies_count"] = len(anomalies)
    kpi["anomalies"] = anomalies[:50]
    kpi = clean_nan(kpi)

    with open(kpi_path, "w", encoding="utf-8") as f:
        json.dump(kpi, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"[更新] {kpi_path}")


def main():
    print("=" * 50)
    print("开始价格异常检测")
    print("=" * 50)

    csv_path = PROCESSED_DIR / "micro_dataset.csv"
    if not csv_path.exists():
        raise SystemExit(f"找不到 {csv_path}，请先运行 clean_ecom.py")

    df = pd.read_csv(csv_path)
    print(f"读取 {len(df)} 条记录")

    # 先用滚动窗口检测
    anomalies_df = detect_rolling(df)
    sigma_multiplier = THRESHOLD_SIGMA
    method = "滚动窗口 2σ"

    # 如果滚动窗口没结果，用整体分布兜底
    if len(anomalies_df) == 0:
        print("[提示] 滚动窗口未检测到异常，切换到整体分布检测")
        anomalies_df = detect_global(df)
        sigma_multiplier = GLOBAL_SIGMA
        method = "整体分布 1.5σ"

    print(f"检测到 {len(anomalies_df)} 个异常（方法：{method}）")

    anomaly_records = build_anomaly_records(anomalies_df, sigma_multiplier)
    anomaly_records = clean_nan(anomaly_records)

    out_path = OUTPUT_DIR / "price_anomalies.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(anomaly_records, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"[输出] {out_path}")

    update_kpi(anomaly_records)

    if anomaly_records:
        print("\n异常 TOP 5：")
        for r in anomaly_records[:5]:
            print(f"  {r['asin']} | {r['date']} | {r['old_price']} → {r['new_price']} | {r['change_pct']}%")
    else:
        print("\n未检测到异常")


if __name__ == "__main__":
    main()