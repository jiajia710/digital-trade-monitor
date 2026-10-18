# -*- coding: utf-8 -*-
"""回退 fix_currency.py 的改动，恢复 CartScout 原始币种标签。

背景：CartScout 首期采集使用了店铺的国际化 URL（rothys.com/en-bg、sansmatin.co.uk/en-eu），
因此这些商品的价格本身就是该地区的真实价格（EUR），并非"误标"。fix_currency.py 把它们错误地
改成了店铺本国币种（USD/GBP）。本脚本将其回退，恢复口径为「信任原始标签 + 固定汇率折算」。

回退规则：
  - rothys.com / thursdayboots.com：USD -> EUR（价格不变）
  - sansmatin.co.uk 中 URL 含 /en-eu/ 的 3 个 Hera：GBP -> EUR；且首期(无 _2026-10-17 后缀)价格 110 -> 170
  - 其余（ngo-shoes.com 已是 EUR、sansmatin 默认 URL 已是 GBP）不变
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
RAW = BASE / "data" / "raw" / "micro"


def fix_file(fp: Path) -> bool:
    data = json.loads(fp.read_text(encoding="utf-8"))
    gp = data.get("get_product") or {}
    store = data.get("store") or gp.get("store") or ""
    url = gp.get("url") or ""

    target_eur = False
    restore_170 = False
    if store in ("rothys.com", "thursdayboots.com"):
        target_eur = True
    elif store == "sansmatin.co.uk" and "/en-eu/" in url:
        target_eur = True
        if "_2026-10-17" not in fp.name:  # 首期（无日期后缀）
            restore_170 = True

    if not target_eur:
        return False

    changed = False
    if gp.get("currency") != "EUR":
        gp["currency"] = "EUR"
        changed = True
    if restore_170 and gp.get("price") == 110.0:
        gp["price"] = 170.0
        changed = True

    ph = data.get("get_price_history")
    if isinstance(ph, dict):
        if ph.get("currency") != "EUR":
            ph["currency"] = "EUR"
            changed = True
        for p in ph.get("points") or []:
            if p.get("currency") != "EUR":
                p["currency"] = "EUR"
                changed = True
            if restore_170 and p.get("price") == 110.0:
                p["price"] = 170.0
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
            print(f"[回退] {fp.name}")
    print(f"\n共回退 {n} 个文件")


if __name__ == "__main__":
    main()
