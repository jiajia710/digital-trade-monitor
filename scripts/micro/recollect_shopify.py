# -*- coding: utf-8 -*-
"""重新采集 Shopify 最新价格（day-2）。

CartScout MCP 不可用时，回退到 Shopify 公开接口：
- 读 day-1 已采集的 shopify_*.json，得到 (store, handle, currency, category) 映射
- 按 store 批量拉 /products.json，命中 handle 时取 variants[0] 最新价格
- 未命中时回退到单商品 /products/{handle}.json
- 写出 shopify_{store}_{handle}_2026-10-17.json（cartscout 结构兼容，供 clean_ecom.py 读取）

币种沿用 day-1 文件记录的 get_product.currency（同一店铺币种不随日期变化）。
"""
import json
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parents[2]
RAW = BASE / "data" / "raw" / "micro"
TODAY = "2026-10-17"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def slug_from_url(url):
    if not url:
        return None
    return url.rstrip("/").split("/")[-1]


def load_day1():
    """读 day-1 文件，返回 {store: {handle: meta}}"""
    stores = {}
    for fp in sorted(RAW.glob("shopify_*.json")):
        if "_2026-10-17" in fp.name:
            continue
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        gp = data.get("get_product") or {}
        url = gp.get("url") or ""
        handle = slug_from_url(url)
        store = data.get("store") or gp.get("store") or ""
        if not store or not handle:
            continue
        stores.setdefault(store, {})[handle] = {
            "currency": gp.get("currency"),
            "category": data.get("category") or "running shoes",
            "title": gp.get("title"),
            "brand": gp.get("brand"),
            "sku": gp.get("sku"),
            "url": url,
        }
    return stores


def fetch_store_products(store):
    """拉取某店铺 /products.json，返回 handle -> product dict"""
    try:
        url = f"https://{store}/products.json?limit=250"
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 200:
            prods = resp.json().get("products", [])
            return {p.get("handle"): p for p in prods}
    except Exception:
        pass
    return {}


def fetch_one_product(store, handle):
    """回退：单商品 .json"""
    try:
        url = f"https://{store}/products/{handle}.json"
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 200:
            return resp.json().get("product")
    except Exception:
        pass
    return None


def build_file(store, handle, meta, product):
    """由 /products.json 的 product 构造 cartscout 兼容结构"""
    variants = product.get("variants") or []
    price = None
    compare_at = None
    available = False
    if variants:
        v = variants[0]
        try:
            price = float(v.get("price"))
        except (TypeError, ValueError):
            price = None
        try:
            compare_at = float(v.get("compare_at_price")) if v.get("compare_at_price") else None
        except (TypeError, ValueError):
            compare_at = None
        available = bool(v.get("available"))
    if price is None:
        return None

    currency = meta.get("currency") or "USD"
    title = product.get("title") or meta.get("title")
    brand = product.get("vendor") or meta.get("brand")
    product_url = meta.get("url") or f"https://{store}/products/{handle}"
    ts = f"{TODAY}T12:00:00Z"

    return {
        "platform": "shopify",
        "store": store,
        "category": meta.get("category") or "running shoes",
        "collected_at": TODAY,
        "get_product": {
            "url": product_url,
            "store": store,
            "title": title,
            "brand": brand,
            "category": None,
            "condition": "new",
            "price": price,
            "original_price": compare_at,
            "discount_percent": None,
            "currency": currency,
            "availability": "in_stock" if available else "out_of_stock",
            "in_stock": available,
            "seller": None,
            "sku": meta.get("sku"),
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
    stores = load_day1()
    total_handles = sum(len(h) for h in stores.values())
    print(f"读取 day-1：{len(stores)} 个店铺，{total_handles} 个商品\n")

    ok = 0
    failed = []
    for store, handles in stores.items():
        store_products = fetch_store_products(store)
        print(f"[店铺] {store}: /products.json 返回 {len(store_products)} 个商品")
        for handle, meta in handles.items():
            product = store_products.get(handle)
            if product is None:
                product = fetch_one_product(store, handle)
            if product is None:
                failed.append(f"{store}/{handle}")
                print(f"  x {handle}: 接口不可用")
                continue

            out = build_file(store, handle, meta, product)
            if out is None:
                failed.append(f"{store}/{handle}")
                print(f"  x {handle}: 无价格")
                continue

            out_path = RAW / f"shopify_{store}_{handle}_{TODAY}.json"
            out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            ok += 1
            print(f"  ✓ {handle}: {out['get_product']['price']} {out['get_product']['currency']}")
        time.sleep(0.3)

    print(f"\n=== 汇总 ===")
    print(f"成功写入: {ok}")
    print(f"失败: {len(failed)}")
    for f in failed:
        print(f"  - {f}")


if __name__ == "__main__":
    main()
