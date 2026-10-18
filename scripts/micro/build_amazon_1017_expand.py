# -*- coding: utf-8 -*-
"""合并扩充后的 Amazon 10-17 数据。

- 读入 octoparse 模板 3387 的导出结果（75 条 = 5 关键词 × 15）
- 与既有 amazon_running_shoes_2026-10-17.json（24 条）合并
- 剔除 Sponsored Ad（adTag=true）、去除内部字段、按 ASIN 去重
- 回写 amazon_running_shoes_2026-10-17.json

用法：python build_amazon_1017_expand.py <导出结果.json 路径>
"""
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
RAW = BASE / "data" / "raw" / "micro"
OUT = RAW / "amazon_running_shoes_2026-10-17.json"

DROP_KEYS = {"input_parameters", "Product_URL_clean"}


def clean(rec):
    return {k: v for k, v in rec.items() if k not in DROP_KEYS}


def main():
    export_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not export_path or not export_path.exists():
        raise SystemExit(f"导出文件不存在: {export_path}")

    export = json.loads(export_path.read_text(encoding="utf-8"))
    new_rows = export.get("data") or []

    existing = json.loads(OUT.read_text(encoding="utf-8"))
    old_products = existing.get("products") or []

    combined = list(old_products) + list(new_rows)
    kept = []
    seen = set()
    ad_count = 0
    dup = 0
    for r in combined:
        if str(r.get("adTag", "")).lower() == "true":
            ad_count += 1
            continue
        c = clean(r)
        a = c.get("ASIN")
        if not a:
            continue
        if a in seen:
            dup += 1
            continue
        seen.add(a)
        kept.append(c)

    out = {
        "platform": "amazon",
        "marketplace": "us",
        "category": "running shoes",
        "collected_at": "2026-10-17",
        "total_collected": len(combined),
        "products": kept,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"合并 raw: {len(combined)}")
    print(f"剔除 Sponsored Ad: {ad_count}")
    print(f"去重 ASIN: {dup}")
    print(f"最终产品数: {len(kept)}")
    print(f"输出: {OUT}")


if __name__ == "__main__":
    main()
