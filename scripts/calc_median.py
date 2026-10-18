import json, glob, os, re, statistics

base = r"C:\Users\lijiayi\micro-pipeline\data\raw\micro"

def median(vals):
    if not vals:
        return None
    s = sorted(vals)
    n = len(s)
    if n % 2:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2

# Amazon
amazon_prices = []
amazon_rows = []
amz = json.load(open(os.path.join(base, "amazon_running_shoes_2026-10-06.json"), encoding="utf-8"))
for p in amz["products"]:
    cp = p.get("Current_price", "")
    m = re.search(r"[\d.]+", cp.replace(",", ""))
    if m:
        amazon_rows.append((p["ASIN"], p["Product_name"], float(m.group())))
print("amazon raw rows:", len(amazon_rows))

# dedup by (title, price)
seen = {}
dedup = []
for asin, title, price in amazon_rows:
    key = (title.strip().lower(), price)
    if key not in seen:
        seen[key] = True
        dedup.append((asin, title, price))
print("amazon dedup:", len(dedup))
amazon_prices = [r[2] for r in dedup]

# Shopify
shopify_rows = []
currency_counter = {}
files = sorted(glob.glob(os.path.join(base, "shopify_*.json")))
files = [f for f in files if "_archive_prev_runs" not in f and "tmp_probe" not in f]
print("shopify files:", len(files))
for f in files:
    d = json.load(open(f, encoding="utf-8"))
    gp = d.get("get_product") or {}
    price = gp.get("price")
    cur = gp.get("currency")
    title = gp.get("title")
    store = gp.get("store") or d.get("store")
    if price is None:
        print("NO PRICE:", os.path.basename(f))
        continue
    shopify_rows.append((store, title, price, cur))
    currency_counter[cur] = currency_counter.get(cur, 0) + 1

print("shopify rows:", len(shopify_rows))
print("currency counts:", currency_counter)

all_prices = amazon_prices + [r[2] for r in shopify_rows]
print("\n--- ALL (mixed currency, as KPI does) ---")
print("n =", len(all_prices))
print("mean =", round(statistics.mean(all_prices), 2))
print("median =", round(median(all_prices), 2))
print("min =", min(all_prices), "max =", max(all_prices))
print("sorted:", sorted(round(x,2) for x in all_prices))

print("\n--- amazon only ---")
print("n =", len(amazon_prices), "mean =", round(statistics.mean(amazon_prices),2),
      "median =", round(median(amazon_prices),2), "min =", min(amazon_prices), "max =", max(amazon_prices))

print("\n--- shopify only (mixed currency) ---")
sp = [r[2] for r in shopify_rows]
print("n =", len(sp), "mean =", round(statistics.mean(sp),2),
      "median =", round(median(sp),2), "min =", min(sp), "max =", max(sp))

print("\n--- shopify USD only ---")
usd = [r[2] for r in shopify_rows if r[3] == "USD"]
print("n =", len(usd), "mean =", round(statistics.mean(usd),2) if usd else None,
      "median =", round(median(usd),2) if usd else None, "min =", min(usd) if usd else None, "max =", max(usd) if usd else None)

print("\n--- non-USD shopify items ---")
for r in shopify_rows:
    if r[3] != "USD":
        print(f"  {r[0]} | {r[3]} {r[2]} | {r[1]}")
