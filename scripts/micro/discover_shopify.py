# -*- coding: utf-8 -*-
"""
Shopify 店铺发现与商品筛选
用法：python discover_shopify.py <关键词> <域名1,域名2,...>
输出：data/raw/micro/discovered_stores.json + shopify_selected.json
"""

import json
import sys
from pathlib import Path
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BASE_DIR / "data" / "raw" / "micro"
RAW_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def fetch_products(domain, limit=250):
    """拉取店铺商品，返回 (成功, 商品列表)"""
    try:
        url = f"https://{domain}/products.json?limit={limit}"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            return True, resp.json().get("products", [])
    except Exception:
        pass
    return False, []


def filter_products(products, domain, keyword, price_min=30, price_max=120, max_per_store=5):
    """按条件筛选商品（keyword 支持逗号分隔，命中任一关键词即保留）"""
    matched = []
    keywords = [k.strip().lower() for k in keyword.split(",") if k.strip()]
    for p in products:
        title = (p.get("title") or "").lower()
        ptype = (p.get("product_type") or "").lower()
        handle = p.get("handle", "").lower()
        if not any(kw in title or kw in ptype or kw in handle for kw in keywords):
            continue

        variants = p.get("variants") or []
        if not variants:
            continue

        try:
            price = float(variants[0].get("price", 0))
        except (ValueError, TypeError):
            continue

        if not (price_min <= price <= price_max):
            continue

        has_stock = any(v.get("available") for v in variants)
        if not has_stock:
            continue

        matched.append({
            "store": domain.split(".")[0],
            "domain": domain,
            "handle": p["handle"],
            "title": p["title"],
            "url": f"https://{domain}/products/{p['handle']}",
            "price": price,
            "category": p.get("product_type") or keywords[0],
            "platform": "shopify",
        })
        if len(matched) >= max_per_store * 3:
            break
    return matched[:max_per_store]


def main():
    if len(sys.argv) < 3:
        print("用法：python discover_shopify.py <关键词> <域名1,域名2,...>")
        sys.exit(1)

    keyword = sys.argv[1]
    candidates = [d.strip() for d in sys.argv[2].split(",") if d.strip()]

    print(f"关键词：{keyword}")
    print(f"候选店铺：{len(candidates)} 个\n")

    valid_stores = []
    all_selected = []

    for domain in candidates:
        ok, products = fetch_products(domain, limit=250)
        if not ok:
            print(f"  x {domain}: 非 Shopify 或接口不可用")
            continue

        valid_stores.append({"domain": domain, "product_count": len(products)})
        matched = filter_products(products, domain, keyword)
        all_selected.extend(matched)
        print(f"  ✓ {domain}: 共 {len(products)} 商品，筛选出 {len(matched)} 个")

    stores_path = RAW_DIR / "discovered_stores.json"
    with open(stores_path, "w", encoding="utf-8") as f:
        json.dump(valid_stores, f, ensure_ascii=False, indent=2)

    selected_path = RAW_DIR / "shopify_selected.json"
    with open(selected_path, "w", encoding="utf-8") as f:
        json.dump(all_selected, f, ensure_ascii=False, indent=2)

    print(f"\n=== 汇总 ===")
    print(f"有效店铺：{len(valid_stores)} 个")
    print(f"重点商品：{len(all_selected)} 个")
    print(f"输出：{stores_path}")
    print(f"输出：{selected_path}")


if __name__ == "__main__":
    main()