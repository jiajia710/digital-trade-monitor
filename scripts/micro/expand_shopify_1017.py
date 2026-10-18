# -*- coding: utf-8 -*-
"""扩充 Shopify 10-17 数据：扫描店铺 /products.json，收集鞋类新品。

CartScout MCP 本会话不可用，回退到 Shopify 公开接口（与 recollect_shopify.py 同源）：
- 读 discovered_stores.json 店铺列表，优先未采集店铺，再回扫已采集店铺找新品
- 逐店拉 /products.json?limit=250
- 筛标题/handle/product_type 含 shoe/sneaker/runner/trainer/boot 等词的商品
- 排除已采集 (store, handle)；每店最多取 6 个；累计约 32 个
- 币种：已采集店铺沿用既有 day-2 币种；新店铺按域名 TLD 推断（.uk->GBP, .fr/.eu->EUR, 默认 USD）
- 写出 shopify_{store}_{handle}_2026-10-17.json（cartscout 兼容结构）
"""
import json
import sys
import time
import re
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parents[2]
RAW = BASE / "data" / "raw" / "micro"
TODAY = "2026-10-17"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
TARGET = 9
PER_STORE = 3

# 鞋类关键词（排除配件：brush/kit/tree/care/tote/bag/sock）
SHOE_PAT = re.compile(r"shoe|sneaker|runner|trainer|boot|loafer|athletic|footwear|slip[- ]?on|slipper|sandalo?|clog|hiking|trail|barefoot", re.I)
NON_SHOE_PAT = re.compile(r"\b(brush|kit|tree|care|tote|bag|sock|socks|laces?|insole|spray|cream|polish|accessory|cap|hat|beanie|pants?|trouser|short|tee|shirt|hoodie|jacket|coat|flag|sticker|ribbon|cord|string|apparel|clothing|gift|box)\b", re.I)

STORE_ORDER = [
    # 继续补扫尚未覆盖的店铺，确保跨 ≥10 个店铺
    "hobibear.com", "saysh.com", "larroude.com", "rothys.com",
    "sansmatin.co.uk", "thursdayboots.com", "beckettsimonon.com", "olivercabell.com",
    "koio.co", "ngo-shoes.com",
]


def slug_from_url(url):
    if not url:
        return None
    try:
        return urlparse(str(url)).path.rstrip("/").split("/")[-1]
    except Exception:
        return None


def infer_currency(domain):
    d = (domain or "").lower()
    if ".uk" in d:
        return "GBP"
    if d.endswith(".fr") or d.endswith(".eu") or d.endswith(".de") or d.endswith(".it") or d.endswith(".es"):
        return "EUR"
    return "USD"


def load_existing():
    existing = set()
    store_currency = {}
    for fp in RAW.glob("shopify_*_2026-10-17.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        gp = data.get("get_product") or {}
        store = data.get("store") or gp.get("store") or ""
        handle = slug_from_url(gp.get("url") or "")
        if store and handle:
            existing.add((store, handle))
        if store and gp.get("currency"):
            store_currency[store] = gp.get("currency")
    return existing, store_currency


def fetch_products(store):
    try:
        url = f"https://{store}/products.json?limit=250"
        resp = requests.get(url, headers=HEADERS, timeout=25)
        if resp.status_code == 200:
            return resp.json().get("products", [])
    except Exception:
        pass
    return []


def is_shoe(p):
    # 仅按标题 + product_type 判断，不按 handle/store 判断（避免品牌名"bangsshoes"误命中配件）
    title = (p.get("title") or "").lower()
    ptype = (p.get("product_type") or "").lower()
    blob = f"{title} {ptype}"
    if not SHOE_PAT.search(blob):
        return False
    if NON_SHOE_PAT.search(blob):
        return False
    return True


def build_file(store, p, currency):
    variants = p.get("variants") or []
    if not variants:
        return None
    v = variants[0]
    try:
        price = float(v.get("price"))
    except (TypeError, ValueError):
        return None
    try:
        compare_at = float(v.get("compare_at_price")) if v.get("compare_at_price") else None
    except (TypeError, ValueError):
        compare_at = None
    available = bool(v.get("available"))

    handle = p.get("handle")
    title = p.get("title")
    brand = p.get("vendor")
    product_url = f"https://{store}/products/{handle}"
    ts = f"{TODAY}T12:00:00Z"

    return {
        "platform": "shopify",
        "store": store,
        "category": "running shoes",
        "collected_at": TODAY,
        "get_product": {
            "url": product_url,
            "store": store,
            "title": title,
            "brand": brand,
            "category": "running shoes",
            "condition": "new",
            "price": price,
            "original_price": compare_at,
            "discount_percent": None,
            "currency": currency,
            "availability": "in_stock" if available else "out_of_stock",
            "in_stock": available,
            "seller": None,
            "sku": v.get("sku"),
            "gtin": None,
            "mpn": None,
            "image": None,
            "image_count": None,
            "rating": None,
            "variant_count": len(variants) or None,
            "variants": None,
            "review_count_on_page": 0,
            "reviews": None,
            "description": None,
            "cached": False,
            "extracted_at": ts,
        },
        "get_price_history": {
            "url": product_url,
            "days": 14,
            "currency": currency,
            "current_price": price,
            "lowest_price": price,
            "highest_price": price,
            "points": [
                {
                    "observed_at": ts,
                    "price": price,
                    "currency": currency,
                    "availability": "in_stock" if available else "out_of_stock",
                }
            ],
            "points_omitted": 0,
        },
    }


def main():
    existing, store_currency = load_existing()
    print(f"已采集 (store,handle) 数: {len(existing)}")

    collected = 0
    stores_hit = []
    for store in STORE_ORDER:
        if collected >= TARGET:
            break
        prods = fetch_products(store)
        currency = store_currency.get(store) or infer_currency(store)
        print(f"[店铺] {store}: /products.json 返回 {len(prods)} 个商品（币种 {currency}）")
        if not prods:
            continue

        store_new = 0
        for p in prods:
            if collected >= TARGET or store_new >= PER_STORE:
                break
            handle = p.get("handle")
            if not handle or (store, handle) in existing:
                continue
            if not is_shoe(p):
                continue
            out = build_file(store, p, currency)
            if out is None:
                continue
            out_path = RAW / f"shopify_{store}_{handle}_{TODAY}.json"
            out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            existing.add((store, handle))
            collected += 1
            store_new += 1
            print(f"  ✓ {handle}: {out['get_product']['price']} {currency}")
        if store_new:
            stores_hit.append(store)
        time.sleep(0.3)

    print(f"\n=== 汇总 ===")
    print(f"新增商品: {collected} 条")
    print(f"覆盖店铺: {len(stores_hit)} 个 -> {stores_hit}")


if __name__ == "__main__":
    main()
