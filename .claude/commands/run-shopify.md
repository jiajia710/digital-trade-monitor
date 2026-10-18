---
description: 一键跑 Shopify 全流程：发现→采集→清洗→监控→可视化→报告
---

给定关键词（默认 "yoga pants"），按顺序执行：

1. 调用 micro-discover：
   - WebSearch 搜索候选店铺
   - 跑 `discover_shopify.py` 验证并筛选
   - 输出 `shopify_selected.json`

2. 调用 micro-collector：
   - 读取 `shopify_selected.json`
   - 对每个 URL 调 cartscout 的 `get_price_history`
   - 保存到 `data/raw/micro/shopify_{store}_{handle}.json`

3. 调用 micro-cleaner：
   - 运行 `clean_ecom.py`
   - 输出 `micro_dataset.csv` 和 `micro_kpi.json`

4. 调用 micro-monitor：
   - 运行 `detect_anomalies.py`
   - 输出 `price_anomalies.json`

5. 调用 micro-viz：
   - 生成 `components/micro-charts.js`

6. 调用 micro-reporter：
   - 生成 `reports/micro_report.md`

## 输出执行报告

用表格汇总每步状态：

| 步骤 | Agent | 状态 | 关键数字 | 产出文件 |
|------|-------|------|----------|----------|

任一步骤失败时，记录失败原因，继续执行不依赖的步骤。