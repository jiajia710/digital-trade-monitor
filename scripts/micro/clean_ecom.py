# -*- coding: utf-8 -*-
"""
清洗和整合电商原始数据
支持两种结构：
1. 批量结构（八爪鱼）：顶层 products 数组
2. Shopify 单品结构（cartscout）：顶层 get_product + get_price_history
"""

import json
import math
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

import pandas as pd
import numpy as np

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BASE_DIR / "data" / "raw" / "micro"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

FIELD_MAP = {
    "asin": ["asin", "ASIN", "product_asin"],
    "sku": ["sku", "SKU", "product_sku"],
    "handle": ["handle", "slug"],
    "title": ["title", "商品标题", "product_title", "name", "Product_name"],
    "brand": ["brand", "品牌"],
    "price": ["price", "售价", "价格", "current_price", "product_price", "Current_price"],
    "original_price": ["original_price", "原价", "list_price", "compare_at_price", "Original_price"],
    "rating": ["rating", "评分", "stars", "average_rating", "Stars"],
    "reviews": ["reviews", "评论数", "review_count", "ratings_total", "review_count_on_page", "Rating_count"],
    "category": ["category", "品类", "类目", "product_category"],
    "platform": ["platform", "平台", "source", "site"],
    "date": ["date", "日期", "采集日期", "snapshot_date", "collected_at", "Current_time"],
    "url": ["url", "link", "商品链接", "product_url", "Product_URL"],
    "store": ["store", "店铺", "shop"],
    "currency": ["currency", "Currency", "币种"],
    "availability": ["availability", "库存", "stock", "in_stock"],
    "bsr": ["bsr", "BSR", "best_seller_rank", "rank"],
    "bsr_category": ["bsr_category", "bsr_label"],
}

TOP_META_FIELDS = ["platform", "category", "collected_at", "marketplace", "date", "store"]

# 固定汇率表：换算为 USD（仅用于统一统计口径，非实时汇率）
CURRENCY_TO_USD = {
    "USD": 1.0,
    "GBP": 1.27,
    "EUR": 1.09,
    "CAD": 0.74,
    "AUD": 0.66,
}


def normalize_currency(val):
    """货币代码归一化为大写；缺失/空值视为 USD"""
    if val is None:
        return "USD"
    if isinstance(val, float) and math.isnan(val):
        return "USD"
    s = str(val).strip().upper()
    if not s or s in ("NAN", "NONE", "NULL", "-"):
        return "USD"
    return s


def clean_nan(obj):
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


def parse_number(val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return np.nan
    if isinstance(val, (int, float, np.integer, np.floating)):
        return float(val)
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", "null", "-"):
        return np.nan
    multiplier = 1.0
    upper = s.upper()
    if upper.endswith("K"):
        multiplier = 1e3
        s = s[:-1]
    elif upper.endswith("M"):
        multiplier = 1e6
        s = s[:-1]
    elif upper.endswith("B"):
        multiplier = 1e9
        s = s[:-1]
    s = s.replace("$", "").replace("¥", "").replace("€", "").replace(",", "").replace(" ", "")
    try:
        return float(s) * multiplier
    except ValueError:
        return np.nan


def parse_date(val):
    """解析各种日期格式（含 ISO 8601），返回 YYYY-MM-DD"""
    if val is None or val == "":
        return None
    try:
        dt = pd.to_datetime(val, errors="coerce", utc=True)
        if pd.isna(dt):
            dt = pd.to_datetime(val, errors="coerce")
        if pd.isna(dt):
            return None
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


def slug_from_url(url):
    if not url:
        return None
    try:
        path = urlparse(str(url)).path.rstrip("/")
        return path.split("/")[-1] if path else None
    except Exception:
        return None


def store_to_platform(store):
    """allbirds.com → allbirds"""
    if not store:
        return "shopify"
    s = str(store).lower()
    if "." in s:
        s = s.split(".")[0]
    return s or "shopify"


def normalize_record(record):
    normalized = {}
    for std_field, aliases in FIELD_MAP.items():
        value = None
        for alias in aliases:
            if alias in record and record[alias] not in (None, "", []):
                value = record[alias]
                break
        normalized[std_field] = value
    return normalized


def extract_batch_records(data, filename):
    """八爪鱼批量结构"""
    records = []
    top_meta = {}
    if isinstance(data, dict):
        for k in TOP_META_FIELDS:
            if k in data and data[k] not in (None, ""):
                top_meta[k] = data[k]

    products = None
    if isinstance(data, dict):
        for key in ["products", "data", "items", "results", "records"]:
            if key in data and isinstance(data[key], list):
                products = data[key]
                break
    elif isinstance(data, list):
        products = data

    if not products:
        return records

    for r in products:
        if not isinstance(r, dict):
            continue
        norm = normalize_record(r)
        if not norm.get("platform"):
            norm["platform"] = top_meta.get("platform") or filename.split("_")[0]
        if not norm.get("category"):
            norm["category"] = top_meta.get("category")
        if not norm.get("date"):
            norm["date"] = top_meta.get("collected_at") or top_meta.get("date")
        norm["source_file"] = filename
        records.append(norm)
    return records


def extract_shopify_records(data, filename):
    """Shopify cartscout 结构：get_product + get_price_history"""
    records = []
    product = data.get("get_product") or {}
    history = data.get("get_price_history") or {}

    url = product.get("url") or history.get("url")
    handle = slug_from_url(url)

    # 优先从顶层读元数据，其次从 product 里读
    top_category = data.get("category")
    top_platform = data.get("platform")
    top_store = data.get("store")
    top_collected = data.get("collected_at")

    store = top_store or product.get("store")
    platform = top_platform or store_to_platform(store)

    base = {
        "asin": handle,
        "handle": handle,
        "sku": product.get("sku"),
        "title": product.get("title"),
        "brand": product.get("brand"),
        "category": top_category or product.get("category"),
        "platform": platform,
        "store": store,
        "currency": product.get("currency") or history.get("currency"),
        "url": url,
        "rating": product.get("rating"),
        "reviews": product.get("reviews") or product.get("review_count_on_page"),
        "availability": product.get("availability"),
    }

    points = history.get("points") or []
    if points:
        for p in points:
            rec = dict(base)
            rec["currency"] = p.get("currency") or base.get("currency")
            rec["price"] = p.get("price")
            rec["date"] = parse_date(p.get("observed_at"))
            rec["availability"] = p.get("availability") or base.get("availability")
            rec["source_file"] = filename
            records.append(rec)
    else:
        rec = dict(base)
        rec["price"] = product.get("price")
        rec["original_price"] = product.get("original_price")
        rec["date"] = parse_date(product.get("extracted_at")) or parse_date(top_collected)
        rec["source_file"] = filename
        records.append(rec)

    return records


def load_all_raw():
    all_records = []
    for fp in sorted(RAW_DIR.glob("*.json")):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict) and "get_product" in data:
                recs = extract_shopify_records(data, fp.name)
                print(f"[读取] {fp.name}: {len(recs)} 条（Shopify 结构）")
            else:
                recs = extract_batch_records(data, fp.name)
                print(f"[读取] {fp.name}: {len(recs)} 条（批量结构）")

            all_records.extend(recs)
        except Exception as e:
            print(f"[跳过] {fp.name}: {e}")

    if not all_records:
        raise SystemExit("没有读到任何原始数据，请检查 data/raw/micro/ 目录")

    return pd.DataFrame(all_records)


def clean(df):
    """清洗并统一口径：
    - price：最终输出为 USD（按 CURRENCY_TO_USD 固定汇率折算：USD 1.0 / GBP 1.27 / EUR 1.09）
    - price_original：保留原始币种下的价格
    - currency：保留原始币种代码
    后续所有统计（avg_price、price_trend_7d、价格带分布等）均基于折算后的 USD price。
    """
    df = df.copy()
    df["price"] = df["price"].apply(parse_number)
    df = df.dropna(subset=["price"])
    df = df[df["price"] > 0]

    # 币种：缺失默认 USD
    if "currency" not in df.columns:
        df["currency"] = "USD"
    df["currency"] = df["currency"].apply(normalize_currency)

    # 保留原始币种价格，再将 price 换算为 USD
    df["price_original"] = df["price"]
    df["price"] = df.apply(
        lambda r: r["price"] * CURRENCY_TO_USD.get(r["currency"], 1.0), axis=1
    )

    for col in ["rating", "reviews", "bsr", "original_price"]:
        if col in df.columns:
            df[col] = df[col].apply(parse_number)

    if "date" in df.columns:
        df["date"] = df["date"].apply(parse_date)
    df["date"] = df["date"].fillna(datetime.now().strftime("%Y-%m-%d"))

    if "asin" not in df.columns:
        df["asin"] = None
    if "handle" in df.columns:
        df["asin"] = df["asin"].fillna(df["handle"])
    if "url" in df.columns:
        df["asin"] = df["asin"].fillna(df["url"].apply(slug_from_url))
    df["asin"] = df["asin"].fillna(
        df["title"].apply(lambda x: f"UNKNOWN_{abs(hash(str(x))) % 10**8}" if pd.notna(x) else None)
    )
    df = df.dropna(subset=["asin"])

    df = df.drop_duplicates(subset=["asin", "date"], keep="last")

    df = df.sort_values(["asin", "date"])

    # 去重：同平台同日，标题（去除 "(variant)" 变体标记）与价格相同的记录视为重复上架，保留第一条
    if "title" in df.columns:
        df["_title_norm"] = (
            df["title"].fillna("").astype(str)
            .str.replace(r"\s*\(variant\)\s*$", "", case=False, regex=True)
            .str.strip()
        )
        df = df.drop_duplicates(
            subset=["platform", "_title_norm", "price", "date"], keep="first"
        )
        df = df.drop(columns=["_title_norm"])
    df["rolling_mean"] = df.groupby("asin")["price"].transform(
        lambda x: x.rolling(window=7, min_periods=1).mean()
    )
    df["rolling_std"] = df.groupby("asin")["price"].transform(
        lambda x: x.rolling(window=7, min_periods=2).std()
    )
    df["price_change_pct"] = df.groupby("asin")["price"].pct_change() * 100
    df["volatility"] = (df["rolling_std"] / df["rolling_mean"]).round(4)

    return df


def build_kpi(df):
    if "category" in df.columns and df["category"].notna().any():
        cat_dist = (
            df.groupby("category")["asin"].nunique()
            .reset_index()
            .rename(columns={"asin": "count"})
            .to_dict("records")
        )
    else:
        cat_dist = [{"category": "未分类", "count": int(df["asin"].nunique())}]

    # 分品类均价与商品数（避免跨品类混合均值失真）
    avg_by_cat = (
        df.groupby("category")
        .agg(avg_price=("price", "mean"), count=("asin", "nunique"))
        .reset_index()
        .sort_values("count", ascending=False)
    )
    avg_by_cat["avg_price"] = avg_by_cat["avg_price"].round(2)
    avg_by_cat = avg_by_cat.to_dict("records")

    # 按「平台 + 品类」分组算日均价，避免跨品类混合导致趋势失真
    trend = (
        df.groupby(["platform", "category", "date"])["price"].mean()
        .reset_index()
        .rename(columns={"price": "avg_price"})
        .sort_values(["platform", "category", "date"])
        .round(2)
        .to_dict("records")
    )

    platform_dist = (
        df.groupby("platform")["asin"].nunique()
        .reset_index()
        .rename(columns={"asin": "count"})
        .to_dict("records")
    ) if "platform" in df.columns else []

    # 同品对比（like-for-like）：仅统计两期均在线商品的真实价格变动，
    # 规避「样本扩容导致快照均价不可直接比较」的误导。
    dates_sorted = sorted(df["date"].dropna().unique().tolist())
    like_for_like = {"up": 0, "down": 0, "same": 0, "avg_change_pct": 0.0}
    if len(dates_sorted) >= 2:
        d0, d1 = dates_sorted[0], dates_sorted[-1]
        p0 = df[df["date"] == d0].drop_duplicates("asin").set_index("asin")["price"].round(2)
        p1 = df[df["date"] == d1].drop_duplicates("asin").set_index("asin")["price"].round(2)
        common = p0.index.intersection(p1.index)
        if len(common):
            old = p0.loc[common]
            new = p1.loc[common]
            delta = new - old
            like_for_like["up"] = int((delta > 0).sum())
            like_for_like["down"] = int((delta < 0).sum())
            like_for_like["same"] = int((delta == 0).sum())
            like_for_like["avg_change_pct"] = round(
                float((new.mean() - old.mean()) / old.mean() * 100), 2
            ) if old.mean() else 0.0

    # 跨期价格带结构（分平台、分日期）：三档 <$50 / $50-100 / >$100 的商品数
    def _band(x):
        if x < 50:
            return "<50"
        if x <= 100:
            return "50-100"
        return ">100"

    price_band_trend = {}
    for d in dates_sorted:
        sub = df[df["date"] == d].drop_duplicates("asin")
        day = {}
        for p in sorted(sub["platform"].dropna().unique().tolist()):
            vc = sub[sub["platform"] == p]["price"].apply(_band).value_counts()
            day[p] = {
                "<50": int(vc.get("<50", 0)),
                "50-100": int(vc.get("50-100", 0)),
                ">100": int(vc.get(">100", 0)),
            }
        price_band_trend[d] = day

    kpi = {
        "updated_at": datetime.now().strftime("%Y-%m-%d"),
        "platforms": sorted([str(p) for p in df["platform"].dropna().unique().tolist()]) if "platform" in df.columns else [],
        "platform_distribution": platform_dist,
        "total_products": int(df["asin"].nunique()),
        "avg_price": round(float(df["price"].mean()), 2),
        "avg_price_note": "全量跨品类混合均值，仅供参考；分品类见 avg_price_by_category",
        "avg_price_by_category": avg_by_cat,
        "anomalies_count": 0,
        "category_distribution": cat_dist,
        "price_trend_7d": trend,
        "like_for_like": like_for_like,
        "price_band_trend": price_band_trend,
        "anomalies": [],
    }
    return kpi


def main():
    print("=" * 50)
    print("开始清洗电商数据")
    print("=" * 50)

    df_raw = load_all_raw()
    print(f"\n合并后共 {len(df_raw)} 条原始记录")

    df_clean = clean(df_raw)
    print(f"清洗后共 {len(df_clean)} 条记录，{df_clean['asin'].nunique()} 个商品")

    csv_path = PROCESSED_DIR / "micro_dataset.csv"
    df_clean.to_csv(csv_path, index=False, encoding="utf-8-sig")
    print(f"[输出] {csv_path}")

    kpi = build_kpi(df_clean)
    kpi = clean_nan(kpi)
    kpi_path = PROCESSED_DIR / "micro_kpi.json"
    with open(kpi_path, "w", encoding="utf-8") as f:
        json.dump(kpi, f, ensure_ascii=False, indent=2, allow_nan=False)
    print(f"[输出] {kpi_path}")

    print("\n前 5 行预览：")
    cols = [c for c in ["asin", "platform", "title", "price", "rating", "reviews", "date"] if c in df_clean.columns]
    print(df_clean[cols].head().to_string(index=False))


if __name__ == "__main__":
    main()