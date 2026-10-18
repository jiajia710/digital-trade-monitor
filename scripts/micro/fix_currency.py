# -*- coding: utf-8 -*-
"""修正 shopify 原始数据中的币种/价格误判（day-1 采集端 CartScout 的误判 + day-2 的沿用）。

问题定位：
  - rothys.com（美国站，原生 USD）被 CartScout 标为 EUR，导致价格被错误 ×1.09
  - thursdayboots.com（美国站，USD）同样被误标为 EUR
  - sansmatin.co.uk（英国站，原生 GBP）中 3 个 Hera 商品被误标为「170 EUR」，
    实为 110 GBP（Shopify /products.json 返回 110，且同店另 2 个 Hera 即为 110 GBP）

修正依据：店铺域名（.co.uk -> GBP；.com/.co 默认 USD）+ Shopify /products.json 原生币种价。
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
RAW = BASE / "data" / "raw" / "micro"

# 店铺 -> 正确币种
STORE_CURRENCY = {
    "sansmatin.co.uk": "GBP",
    "rothys.com": "USD",
    "thursdayboots.com": "USD",
    "ngo-shoes.com": "EUR",  # 已正确，保留
}

# sansmatin Hera 误读价 -> 正确价（GBP）
SANSMATIN_PRICE_FIX = {170.0: 110.0, 170: 110.0}


def fix_file(fp: Path) -> bool:
    data = json.loads(fp.read_text(encoding="utf-8"))
    store = data.get("store") or ""
    cur = STORE_CURRENCY.get(store)
    if cur is None:
        return False

    changed = False

    gp = data.get("get_product")
    if isinstance(gp, dict):
        if gp.get("currency") != cur:
            gp["currency"] = cur
            changed = True
        # 修正误读价格
        old_price = gp.get("price")
        if store == "sansmatin.co.uk" and old_price in SANSMATIN_PRICE_FIX:
            gp["price"] = SANSMATIN_PRICE_FIX[old_price]
            changed = True

    ph = data.get("get_price_history")
    if isinstance(ph, dict):
        if ph.get("currency") != cur:
            ph["currency"] = cur
            changed = True
        for p in ph.get("points") or []:
            if p.get("currency") != cur:
                p["currency"] = cur
                changed = True
            op = p.get("price")
            if store == "sansmatin.co.uk" and op in SANSMATIN_PRICE_FIX:
                p["price"] = SANSMATIN_PRICE_FIX[op]
                changed = True
        # 同步 history 汇总字段
        pts = ph.get("points") or []
        if pts:
            vals = [p["price"] for p in pts if isinstance(p.get("price"), (int, float))]
            if vals:
                ph["current_price"] = vals[-1]
                ph["lowest_price"] = min(vals)
                ph["highest_price"] = max(vals)

    if changed:
        fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return changed


def main():
    n = 0
    for fp in sorted(RAW.glob("shopify_*.json")):
        if fix_file(fp):
            n += 1
            print(f"[修正] {fp.name}")
    print(f"\n共修正 {n} 个文件")


if __name__ == "__main__":
    main()
