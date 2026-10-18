/**
 * 微观电商数据图表组件（echarts-micro）
 *
 * 数据源：
 *   - data/processed/micro_kpi.json        KPI / 分品类均价 / 品类分布 / price_trend_7d /
 *                                          like_for_like / price_band_trend（USD 口径）
 *   - data/output/price_anomalies.json     异常预警（ASIN 级，价格 USD 口径）
 *   - data/processed/micro_dataset.csv     仅用于建立 ASIN -> 平台/品类/币种 映射
 *
 * 依赖：ECharts 5.x（由页面 CDN 引入）
 * 暴露：window.initMicroCharts()
 *
 * 口径说明：全部价格（KPI 均价、price_trend_7d、异常明细 old_price/new_price）均已按固定汇率折算为 USD
 *           （EUR 1.09 / GBP 1.27）；CSV 的 price_original / currency 字段保留原始币种，仅作溯源标注。
 *
 * 本批数据：单品类（running shoes）+ 跨期两日快照（2026-10-06 / 2026-10-17），
 *           合并去重后 164 商品（amazon 66 + shopify 98），异常 5 条（5 个唯一 ASIN）。
 *           KPI 新增 like_for_like（两期同品对比）与 price_band_trend（跨期价格带结构），
 *           用「同品价格变动分布」与「价格带结构演变」两个图表取代误导性的单日快照均价对比。
 */
(function (global) {
  'use strict';

  /* ---------------- 主题 ---------------- */
  const THEME = {
    bg: '#0a1628',
    panel: '#0d1f3c',
    primary: '#1e90ff',
    danger: '#ff4d4f',
    warning: '#faad14',
    text: '#ffffff',
    subText: '#a0b4d0',
    gridLine: 'rgba(30,144,255,0.12)',
    axisLine: 'rgba(30,144,255,0.35)',
    borderGlow: 'rgba(30,144,255,0.25)'
  };

  const SERIES_COLORS = ['#1e90ff', '#00d4ff', '#3a7bd5', '#8f7bff', '#00c8a0', '#ffb84d'];

  const FX_NOTE = 'USD 口径 · EUR/GBP 按固定汇率折算';

  /* ---------------- 工具函数 ---------------- */
  function el(tag, text, css) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    if (css) n.style.cssText = css;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function round2(v) {
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  // 价格（USD 口径，统一用于 KPI / 走势 / 异常明细）
  function fmtPrice(v) {
    const n = Number(v);
    return '$' + (isFinite(n) ? n.toFixed(2) : '-');
  }

  function fmtPct(v) {
    const n = Number(v);
    if (!isFinite(n)) return '-';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function shortAsin(s) {
    s = String(s || '');
    return s.length <= 26 ? s : s.slice(0, 23) + '…';
  }

  // 商品标题短名：去掉「 - 颜色/材质」后缀，便于轮播表快速识别商品
  function shortTitle(t) {
    const s = String(t == null ? '' : t).trim();
    const idx = s.indexOf(' - ');
    return idx > 0 ? s.slice(0, idx) : s;
  }

  // 极简 CSV 解析（处理带引号字段与 \r\n）
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch === '\r') {
        // 跳过
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ASIN -> { platform, category, currency, brand }，用于异常点定位与原始币种溯源
  function buildAsinMeta(csvText) {
    const rows = parseCsv(csvText || '');
    if (!rows.length) return {};
    const headers = rows[0].map(function (h) { return h.replace(/^﻿/, '').trim(); });
    const iAsin = headers.indexOf('asin');
    const iPlat = headers.indexOf('platform');
    const iCat = headers.indexOf('category');
    const iCur = headers.indexOf('currency');
    const iBrand = headers.indexOf('brand');
    if (iAsin < 0) return {};
    const map = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r[iAsin]) {
        map[r[iAsin].trim()] = {
          platform: iPlat >= 0 ? (r[iPlat] || '').trim() : '',
          category: iCat >= 0 ? (r[iCat] || '').trim() : '',
          currency: iCur >= 0 ? (r[iCur] || '').trim().toUpperCase() : '',
          brand: iBrand >= 0 ? (r[iBrand] || '').trim() : ''
        };
      }
    }
    return map;
  }

  // 汇总非 USD 商品数，用于标注「按固定汇率折算」口径
  function fxSummary(asinMeta) {
    let eur = 0, gbp = 0;
    Object.keys(asinMeta || {}).forEach(function (k) {
      const c = asinMeta[k].currency;
      if (c === 'EUR') eur++;
      else if (c === 'GBP') gbp++;
    });
    const total = eur + gbp;
    return { eur: eur, gbp: gbp, total: total };
  }

  // 兼容两种 price_trend_7d 形态：数组记录 / {品类: [...]} 字典
  function normalizeTrend(raw) {
    if (Array.isArray(raw)) return raw.slice();
    const out = [];
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach(function (category) {
        (raw[category] || []).forEach(function (pt) {
          out.push(Object.assign({}, pt, { category: pt && pt.category ? pt.category : category }));
        });
      });
    }
    return out;
  }

  function baseTooltip() {
    return {
      backgroundColor: 'rgba(10,22,40,0.95)',
      borderColor: 'rgba(30,144,255,0.5)',
      textStyle: { color: THEME.text, fontSize: 12 },
      extraCssText: 'box-shadow:0 0 12px rgba(30,144,255,0.25);'
    };
  }

  /* ---------------- 图表 0：KPI 指标卡 ---------------- */
  function buildCard(cfg) {
    const card = el('div', null,
      'flex:1;min-width:160px;background:' + THEME.panel + ';border:1px solid ' + THEME.borderGlow +
      ';border-radius:8px;padding:14px 12px;text-align:center;');
    card.appendChild(el('div', cfg.label, 'color:' + THEME.subText + ';font-size:12px;margin-bottom:8px;'));

    const valWrap = el('div');
    const val = el('span', cfg.value, 'color:' + (cfg.color || THEME.text) + ';font-size:26px;font-weight:bold;');
    valWrap.appendChild(val);
    if (cfg.unit) valWrap.appendChild(el('span', ' ' + cfg.unit, 'color:' + THEME.subText + ';font-size:12px;'));
    card.appendChild(valWrap);

    if (cfg.sub) card.appendChild(el('div', cfg.sub, 'color:' + THEME.subText + ';font-size:11px;margin-top:6px;'));
    return card;
  }

  function buildMiniCard(category, price, count) {
    const card = el('div', null,
      'flex:0 0 auto;min-width:128px;max-width:200px;background:' + THEME.panel +
      ';border:1px solid rgba(30,144,255,0.2);border-radius:6px;padding:8px 10px;');
    const name = el('div', category, 'color:' + THEME.subText + ';font-size:11px;margin-bottom:4px;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
    name.title = category;
    card.appendChild(name);
    card.appendChild(el('div', fmtPrice(price), 'color:' + THEME.primary + ';font-size:16px;font-weight:bold;'));
    card.appendChild(el('div', (count || 0) + ' 件商品', 'color:' + THEME.subText + ';font-size:10px;margin-top:2px;'));
    return card;
  }

  function renderKpiCards(container, kpi, fx) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = el('div', null, 'display:flex;flex-direction:column;gap:12px;');

    const platInfo = (kpi.platform_distribution || []).map(function (p) {
      return p.platform + ' ' + p.count;
    }).join(' · ');

    const fxText = (fx && fx.total > 0)
      ? FX_NOTE + '（' + fx.total + ' 个 EUR/GBP 商品已折算）'
      : FX_NOTE;
    wrap.appendChild(el('div',
      '数据更新：' + (kpi.updated_at || '-') + '　平台：' + (platInfo || (kpi.platforms || []).join(', ') || '-'),
      'color:' + THEME.subText + ';font-size:12px;'));
    wrap.appendChild(el('div', '口径：' + fxText, 'color:' + THEME.warning + ';font-size:12px;'));

    const primary = el('div', null, 'display:flex;gap:16px;flex-wrap:wrap;');
    primary.appendChild(buildCard({ label: '商品总数', value: String(kpi.total_products || 0), unit: '件', color: THEME.text }));
    primary.appendChild(buildCard({
      label: '全平台均价', value: fmtPrice(kpi.avg_price), color: THEME.primary,
      sub: '受 10-17 样本扩容影响 · USD 口径'
    }));

    const lfl = kpi.like_for_like || {};
    const lflPct = lfl.avg_change_pct != null
      ? (Number(lfl.avg_change_pct) > 0 ? '+' : '') + Number(lfl.avg_change_pct).toFixed(2) + '%'
      : '-';
    primary.appendChild(buildCard({
      label: '同品价格变动', value: lflPct,
      color: (Number(lfl.avg_change_pct) >= 0 ? THEME.danger : THEME.primary),
      sub: '两期同品 · 涨 ' + (lfl.up || 0) + ' / 跌 ' + (lfl.down || 0) + ' / 平 ' + (lfl.same || 0)
    }));

    primary.appendChild(buildCard({
      label: '异常预警', value: String(kpi.anomalies_count != null ? kpi.anomalies_count : 0), unit: '条',
      color: THEME.danger, sub: '价格波动超阈值'
    }));
    primary.appendChild(buildCard({
      label: '监测平台', value: String((kpi.platforms || []).length || (kpi.platform_distribution || []).length || 0), unit: '个',
      color: THEME.text, sub: (kpi.platforms || []).join(' + ')
    }));
    wrap.appendChild(primary);

    wrap.appendChild(el('div', '分品类均价（USD）', 'color:' + THEME.text + ';font-size:14px;font-weight:bold;'));
    const catWrap = el('div', null, 'display:flex;gap:10px;flex-wrap:wrap;');
    const cats = (kpi.avg_price_by_category || []).slice().sort(function (a, b) {
      return (b.count || 0) - (a.count || 0);
    });
    cats.forEach(function (c) {
      catWrap.appendChild(buildMiniCard(c.category, c.avg_price, c.count));
    });
    wrap.appendChild(catWrap);

    container.appendChild(wrap);
  }

  /* ---------------- 图表 1A：同品价格变动分布（Like-for-Like 环形图） ---------------- */
  function renderLikeForLike(container, kpi) {
    if (!container) return null;
    const chart = echarts.init(container);

    const lfl = kpi.like_for_like || {};
    const up = Number(lfl.up) || 0;
    const down = Number(lfl.down) || 0;
    const same = Number(lfl.same) || 0;
    const total = up + down + same;
    const pct = lfl.avg_change_pct != null ? Number(lfl.avg_change_pct) : null;

    const data = [
      { name: '涨价', value: up, itemStyle: { color: THEME.danger } },
      { name: '降价', value: down, itemStyle: { color: THEME.primary } },
      { name: '持平', value: same, itemStyle: { color: '#3d5a80' } }
    ].filter(function (d) { return d.value > 0; });

    const centerText = pct == null ? '暂无' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';

    chart.setOption({
      backgroundColor: THEME.bg,
      title: {
        text: '同品价格变动分布（Like-for-Like）',
        subtext: '两期均在线 ' + total + ' 件商品 · 涨 ' + up + ' / 跌 ' + down + ' / 平 ' + same,
        left: 10, top: 8,
        textStyle: { color: THEME.text, fontSize: 14 },
        subtextStyle: { color: THEME.subText, fontSize: 11 }
      },
      tooltip: Object.assign(baseTooltip(), {
        trigger: 'item',
        formatter: function (p) {
          return '<b>' + esc(p.name) + '</b><br/>' + p.value + ' 件 · ' + p.percent + '%';
        }
      }),
      legend: {
        orient: 'vertical', right: 8, top: 'middle',
        textStyle: { color: THEME.subText, fontSize: 11 }, itemWidth: 14, itemHeight: 8
      },
      graphic: [
        {
          type: 'text', left: '36%', top: '46%',
          style: { text: centerText, fill: THEME.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center' }
        },
        {
          type: 'text', left: '36%', top: '58%',
          style: { text: '同品均价变化', fill: THEME.subText, fontSize: 11, textAlign: 'center' }
        }
      ],
      series: [{
        type: 'pie', radius: ['50%', '72%'], center: ['36%', '54%'],
        itemStyle: { borderColor: THEME.bg, borderWidth: 2 },
        label: { show: true, position: 'outside', formatter: '{b}\n{d}%', color: THEME.subText, fontSize: 11 },
        labelLine: { lineStyle: { color: 'rgba(30,144,255,0.35)' } },
        emphasis: {
          label: { fontSize: 12, color: THEME.text },
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(30,144,255,0.5)' }
        },
        data: data
      }]
    });

    return chart;
  }

  /* ---------------- 图表 1B：价格带结构演变（按平台，堆叠柱状图） ---------------- */
  function renderBandTrend(container, kpi) {
    if (!container) return null;
    const chart = echarts.init(container);

    const raw = kpi.price_band_trend || {};
    const dates = Object.keys(raw).sort();
    const platforms = ['amazon', 'shopify'];

    // x 轴顺序：按平台分组（10-06 Amazon、10-17 Amazon、10-06 Shopify、10-17 Shopify）
    const categories = [];
    platforms.forEach(function (p) {
      dates.forEach(function (d) {
        categories.push(d + '|' + p);
      });
    });

    const bandKeys = ['<50', '50-100', '>100'];
    const bandNames = ['<$50', '$50-100', '>$100'];
    const bandColors = { '<50': '#00d4ff', '50-100': '#1e90ff', '>100': '#8f7bff' };

    const totals = categories.map(function (k) {
      const parts = k.split('|');
      const b = (raw[parts[0]] || {})[parts[1]] || {};
      return (Number(b['<50']) || 0) + (Number(b['50-100']) || 0) + (Number(b['>100']) || 0);
    });

    const series = bandKeys.map(function (bk, i) {
      return {
        name: bandNames[i],
        type: 'bar',
        stack: 'total',
        barMaxWidth: 64,
        itemStyle: { color: bandColors[bk] },
        data: categories.map(function (k, idx) {
          const parts = k.split('|');
          const b = (raw[parts[0]] || {})[parts[1]] || {};
          const v = Number(b[bk]) || 0;
          const t = totals[idx] || 1;
          return round2(v / t * 100);
        })
      };
    });

    const xLabels = categories.map(function (k) {
      const parts = k.split('|');
      return parts[0].slice(5) + ' ' + (parts[1] === 'amazon' ? 'Amazon' : 'Shopify');
    });

    chart.setOption({
      backgroundColor: THEME.bg,
      title: {
        text: '价格带结构演变（按平台 · 占比 %）',
        left: 10, top: 10,
        textStyle: { color: THEME.text, fontSize: 14 }
      },
      tooltip: Object.assign(baseTooltip(), {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (params) {
          if (!params || !params.length) return '';
          let html = '<b>' + esc(params[0].name) + '</b>';
          params.forEach(function (p) {
            html += '<br/>' + p.marker + esc(p.seriesName) + ': ' + p.value + '%';
          });
          return html;
        }
      }),
      legend: {
        orient: 'vertical', right: 10, top: 'middle',
        itemWidth: 14, itemHeight: 8,
        textStyle: { color: THEME.subText, fontSize: 11 }
      },
      grid: { left: 60, right: 150, top: 80, bottom: 40 },
      xAxis: {
        type: 'category', data: xLabels,
        axisLine: { lineStyle: { color: THEME.axisLine } }, axisTick: { show: false },
        axisLabel: { color: THEME.subText, fontSize: 11, interval: 0 }
      },
      yAxis: {
        type: 'value', max: 100,
        axisLabel: { color: THEME.subText, formatter: '{value}%' },
        axisLine: { lineStyle: { color: THEME.axisLine } },
        splitLine: { lineStyle: { color: THEME.gridLine } }
      },
      series: series
    });

    return chart;
  }

  /* ---------------- 图表 2：品类分布环形图 ---------------- */
  function renderCategoryDonut(container, kpi) {
    if (!container) return null;
    const chart = echarts.init(container);

    const dist = (kpi.category_distribution || []).slice().sort(function (a, b) {
      return (b.count || 0) - (a.count || 0);
    });
    const singleCategory = dist.length === 1;
    const platformDist = (kpi.platform_distribution || []).slice();

    // 单品类快照：环形图优雅降级为「品类 × 平台」拆分，避免 100% 纯色环
    let data, subtext;
    if (singleCategory && platformDist.length > 1) {
      const catName = dist[0].category;
      data = platformDist.map(function (p, i) {
        return {
          name: catName + ' · ' + p.platform,
          value: p.count,
          itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] }
        };
      });
      subtext = '单品类快照（' + catName + '）· 按平台拆分：' +
        platformDist.map(function (p) { return p.platform + ' ' + p.count; }).join(' · ');
    } else {
      const top = dist.slice(0, 5);
      const rest = dist.slice(5).reduce(function (s, c) { return s + (c.count || 0); }, 0);
      data = top.map(function (c, i) {
        return { name: c.category, value: c.count, itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] } };
      });
      if (rest > 0) data.push({ name: '其他', value: rest, itemStyle: { color: '#3d5a80' } });
      subtext = singleCategory ? '本批为单品类快照（running shoes）' : '';
    }

    const total = (singleCategory ? dist : dist).reduce(function (s, c) { return s + (c.count || 0); }, 0);

    chart.setOption({
      backgroundColor: THEME.bg,
      title: {
        text: '品类分布（商品数占比）',
        subtext: subtext,
        left: 10, top: 8,
        textStyle: { color: THEME.text, fontSize: 14 },
        subtextStyle: { color: THEME.subText, fontSize: 11 }
      },
      tooltip: Object.assign(baseTooltip(), {
        trigger: 'item',
        formatter: function (p) { return '<b>' + esc(p.name) + '</b><br/>' + p.value + ' 件 · ' + p.percent + '%'; }
      }),
      legend: {
        orient: 'vertical', right: 8, top: 'middle',
        textStyle: { color: THEME.subText, fontSize: 11 }, itemWidth: 14, itemHeight: 8
      },
      graphic: [
        {
          type: 'text', left: '36%', top: '46%',
          style: { text: String(total), fill: THEME.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center' }
        },
        {
          type: 'text', left: '36%', top: '58%',
          style: { text: '件商品', fill: THEME.subText, fontSize: 11, textAlign: 'center' }
        }
      ],
      series: [{
        type: 'pie', radius: ['50%', '72%'], center: ['36%', '54%'],
        itemStyle: { borderColor: THEME.bg, borderWidth: 2 },
        label: {
          show: true, position: 'outside', formatter: '{b}\n{d}%',
          color: THEME.subText, fontSize: 11
        },
        labelLine: { lineStyle: { color: 'rgba(30,144,255,0.35)' } },
        emphasis: {
          label: { fontSize: 12, color: THEME.text },
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(30,144,255,0.5)' }
        },
        data: data
      }]
    });

    // 环形图轮播高亮动效
    let cur = 0;
    const n = data.length;
    setInterval(function () {
      if (document.hidden || n === 0) return;
      chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
      chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: cur });
      cur = (cur + 1) % n;
    }, 2400);

    return chart;
  }

  /* ---------------- 图表 3：ASIN 价格波动率排行（TOP 10） ---------------- */
  function renderVolatilityRank(container, anomalies, asinMeta) {
    if (!container) return null;
    const chart = echarts.init(container);

    // 跨期两日快照：同一 ASIN 在每日各有一条异常记录，先按 ASIN 去重（保留 |change_pct| 最大者）
    const byAsin = {};
    (anomalies || []).forEach(function (a) {
      if (!a.asin) return;
      const pct = Math.abs(Number(a.change_pct) || 0);
      if (!byAsin[a.asin] || pct > Math.abs(Number(byAsin[a.asin].change_pct) || 0)) {
        byAsin[a.asin] = a;
      }
    });
    const dates = Array.from(new Set((anomalies || []).map(function (a) { return a.date; }).filter(Boolean))).sort();
    const items = Object.keys(byAsin).map(function (k) { return byAsin[k]; }).sort(function (a, b) {
      return Math.abs(b.change_pct) - Math.abs(a.change_pct);
    });
    const data = items.map(function (a) {
      const meta = (asinMeta || {})[a.asin] || {};
      return {
        name: a.asin,
        value: round2(Math.abs(Number(a.change_pct) || 0)),
        pct: Number(a.change_pct),
        date: a.date,
        old_price: a.old_price,
        new_price: a.new_price,
        threshold: a.threshold,
        orig_currency: meta.currency || '',
        title: a.title
      };
    });
    const topN = data.slice(0, 10);
    const labels = topN.map(function (d) { return shortAsin(d.name); }).reverse();
    const barData = topN.slice().reverse().map(function (d) {
      const positive = d.pct >= 0;
      const base = positive ? THEME.danger : THEME.primary;
      return Object.assign({}, d, {
        itemStyle: {
          borderRadius: 7,
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: base },
            { offset: 1, color: positive ? 'rgba(255,77,79,0.10)' : 'rgba(30,144,255,0.10)' }
          ])
        }
      });
    });

    chart.setOption({
      backgroundColor: THEME.bg,
      title: {
        text: 'ASIN 价格波动率排行（TOP 10）',
        subtext: '跨期 ' + dates.join(' / ') + ' · ' + data.length + ' 个异常 ASIN · 价格 USD 口径',
        left: 10, top: 8,
        textStyle: { color: THEME.text, fontSize: 14 },
        subtextStyle: { color: THEME.subText, fontSize: 11 }
      },
      tooltip: Object.assign(baseTooltip(), {
        trigger: 'item',
        formatter: function (p) {
          const d = p.data;
          return '<b>' + esc(shortAsin(d.name)) + '</b><br/>' +
            (d.title ? '品名: ' + esc(d.title) + '<br/>' : '') +
            '日期: ' + esc(d.date || '-') + '<br/>' +
            '波动: <b style="color:' + (d.pct >= 0 ? THEME.danger : THEME.primary) + '">' + fmtPct(d.pct) + '</b>' +
            '（阈值 ' + esc(d.threshold) + '%）<br/>' +
            '价格: ' + fmtPrice(d.old_price) + ' → ' + fmtPrice(d.new_price) +
            (d.orig_currency && d.orig_currency !== 'USD' ? '<br/>原始币种: ' + esc(d.orig_currency) : '');
        }
      }),
      grid: { left: 12, right: 56, top: 72, bottom: 20, containLabel: true },
      xAxis: {
        type: 'value', name: '波动幅度 (%)',
        nameTextStyle: { color: THEME.subText },
        axisLabel: { color: THEME.subText },
        axisLine: { lineStyle: { color: THEME.axisLine } },
        splitLine: { lineStyle: { color: THEME.gridLine } }
      },
      yAxis: {
        type: 'category', inverse: true, data: labels,
        axisLine: { lineStyle: { color: THEME.axisLine } }, axisTick: { show: false },
        axisLabel: { color: THEME.subText, fontSize: 11 }
      },
      series: [{
        type: 'bar', barWidth: 14, data: barData,
        label: {
          show: true, position: 'right', color: THEME.text, fontWeight: 'bold',
          formatter: function (p) { return fmtPct(p.data.pct); }
        }
      }]
    });

    return chart;
  }

  /* ---------------- 图表 4：异常预警轮播表 ---------------- */

  // 按 ASIN 去重，同一 ASIN 只保留 |change_pct| 最大的一条
  function dedupAnomalies(items, asinMeta) {
    const groups = {};
    items.forEach(function (a) {
      const asin = a.asin;
      if (!asin) return;
      const meta = (asinMeta || {})[asin] || {};
      const base = shortTitle(a.title) || shortAsin(asin);
      const pct = Math.abs(Number(a.change_pct) || 0);
      if (!groups[asin]) {
        groups[asin] = { brand: meta.brand || '', base: base, item: a, pct: pct };
      } else if (pct > groups[asin].pct) {
        groups[asin] = { brand: meta.brand || groups[asin].brand, base: base, item: a, pct: pct };
      }
    });
    return Object.keys(groups).map(function (k) {
      const g = groups[k];
      let name = g.base;
      const brand = (g.brand || '').trim();
      if (brand && name.toLowerCase().indexOf(brand.toLowerCase()) !== 0) {
        name = brand + ' ' + name;
      }
      return { name: name, item: g.item };
    });
  }

  function renderAnomalyTable(container, anomalies, asinMeta) {
    if (!container) return;
    container.innerHTML = '';

    const wrap = el('div', null,
      'background:' + THEME.panel + ';border:1px solid ' + THEME.borderGlow +
      ';border-radius:8px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;padding:12px;overflow:hidden;');
    wrap.appendChild(el('div', '异常预警轮播（价格 USD 口径）', 'color:' + THEME.text + ';font-size:14px;font-weight:bold;margin-bottom:10px;flex:0 0 auto;'));

    const header = el('div', null,
      'display:grid;grid-template-columns:2.8fr 1.3fr 0.9fr 0.9fr 0.9fr 0.8fr;gap:6px;padding:6px 8px;' +
      'border-bottom:1px solid rgba(30,144,255,0.3);flex:0 0 auto;');
    ['商品标题', 'ASIN', '日期', '原价', '现价', '变化'].forEach(function (h) {
      header.appendChild(el('span', h, 'color:' + THEME.text + ';font-size:11px;font-weight:bold;'));
    });
    wrap.appendChild(header);

    const viewport = el('div', null, 'flex:1 1 auto;overflow:hidden;position:relative;');
    const list = el('ul', null, 'margin:0;padding:0;list-style:none;');

    function buildRow(a, name) {
      const meta = (asinMeta || {})[a.asin] || {};
      const origCurrency = meta.currency || '';
      const label = name || shortTitle(a.title) || shortAsin(a.asin);
      const li = el('li', null,
        'display:grid;grid-template-columns:2.8fr 1.3fr 0.9fr 0.9fr 0.9fr 0.8fr;gap:6px;padding:0 8px;' +
        'height:26px;align-items:center;border-bottom:1px solid rgba(30,144,255,0.08);');
      const tCell = el('span', label,
        'color:' + THEME.text + ';font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
      tCell.title = a.title || a.asin;
      li.appendChild(tCell);
      const asin = el('span', shortAsin(a.asin),
        'color:' + THEME.subText + ';font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
      asin.title = a.asin + (origCurrency ? ' · 原始币种 ' + origCurrency : '');
      li.appendChild(asin);
      li.appendChild(el('span', a.date, 'color:' + THEME.subText + ';font-size:11px;'));
      li.appendChild(el('span', fmtPrice(a.old_price), 'color:' + THEME.subText + ';font-size:11px;'));
      li.appendChild(el('span', fmtPrice(a.new_price), 'color:' + THEME.subText + ';font-size:11px;'));
      const pctEl = el('span', fmtPct(a.change_pct),
        'color:' + (Number(a.change_pct) >= 0 ? THEME.danger : THEME.primary) + ';font-size:11px;font-weight:bold;');
      li.appendChild(pctEl);
      return li;
    }

    const items = anomalies || [];
    if (!items.length) {
      list.appendChild(el('li', '暂无异常记录', 'color:' + THEME.subText + ';font-size:12px;padding:10px 8px;'));
      viewport.appendChild(list);
      wrap.appendChild(viewport);
      container.appendChild(wrap);
      return;
    }

    // 按款式去重后无缝滚动：列表复制一份接在尾部，translateY 到一半时瞬间归零
    const rows = dedupAnomalies(items, asinMeta);
    rows.forEach(function (r) { list.appendChild(buildRow(r.item, r.name)); });
    rows.forEach(function (r) { list.appendChild(buildRow(r.item, r.name)); });
    viewport.appendChild(list);
    wrap.appendChild(viewport);
    container.appendChild(wrap);

    let y = 0;
    setInterval(function () {
      if (document.hidden || !list.scrollHeight) return;
      const half = list.scrollHeight / 2;
      y = (y + 1) % half;
      list.style.transform = 'translateY(-' + y + 'px)';
    }, 40);
  }

  /* ---------------- 入口 ---------------- */
  let charts = [];
  let resizeBound = false;

  function onResize() {
    charts.forEach(function (c) { if (c && !c.isDisposed()) c.resize(); });
  }

  async function initMicroCharts() {
    if (typeof echarts === 'undefined') {
      console.warn('[micro-charts] ECharts 未加载，跳过渲染。');
      return;
    }

    const kpi = await fetch('data/processed/micro_kpi.json?v=' + Date.now())
      .then(function (r) { return r.json(); })
      .catch(function () { return {}; });
    const anomalies = await fetch('data/output/price_anomalies.json?v=' + Date.now())
      .then(function (r) { return r.json(); })
      .catch(function () { return []; });

    // CSV 用于 ASIN -> 平台/品类/币种 映射（异常点定位与币种标注），失败则降级为无币种
    let asinMeta = {};
    try {
      const csvText = await fetch('data/processed/micro_dataset.csv?v=' + Date.now()).then(function (r) { return r.text(); });
      asinMeta = buildAsinMeta(csvText);
    } catch (e) {
      asinMeta = {};
    }
    const fx = fxSummary(asinMeta);

    // 支持重复调用：先销毁旧实例，避免内存泄漏与重复 resize
    charts.forEach(function (c) { try { c.dispose(); } catch (e) { /* ignore */ } });
    charts = [];

    renderKpiCards(document.getElementById('micro-kpi-cards'), kpi, fx);

    // 淘汰「单日快照均价对比」：拆分为「同品价格变动分布」+「价格带结构演变」两个图表（左右并列）
    const trendBox = document.getElementById('micro-price-trend');
    if (trendBox) {
      trendBox.innerHTML = '';
      trendBox.style.display = 'flex';
      trendBox.style.gap = '12px';
      const lflBox = el('div', null, 'flex:1 1 50%;min-width:0;height:100%;');
      const bandBox = el('div', null, 'flex:1 1 50%;min-width:0;height:100%;');
      trendBox.appendChild(lflBox);
      trendBox.appendChild(bandBox);
      charts.push(renderLikeForLike(lflBox, kpi));
      charts.push(renderBandTrend(bandBox, kpi));
    }

    charts.push(renderCategoryDonut(document.getElementById('micro-category'), kpi));
    charts.push(renderVolatilityRank(document.getElementById('micro-volatility'), anomalies, asinMeta));
    renderAnomalyTable(document.getElementById('micro-anomaly-table'), anomalies, asinMeta);

    // 容器尺寸真实变化时 resize（本看板未用 1920 等比缩放容器，故需要）
    if (!resizeBound) {
      window.addEventListener('resize', onResize);
      resizeBound = true;
    }
  }

  /* ---------------- 报告模态框 ---------------- */
  function initReportModal() {
    const btn = document.getElementById('view-report-btn');
    const modal = document.getElementById('report-modal');
    const content = document.getElementById('report-modal-content');
    const closeBtn = document.getElementById('report-modal-close');
    if (!btn || !modal || !content) return;

    function onKey(e) { if (e.key === 'Escape') close(); }

    function close() {
      modal.hidden = true;
      document.removeEventListener('keydown', onKey);
    }

    function open() {
      modal.hidden = false;
      document.addEventListener('keydown', onKey);
      if (content.dataset.loaded === '1') return;
      fetch('reports/micro_report.md?v=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (md) {
          content.innerHTML = (typeof marked !== 'undefined' && marked.parse)
            ? marked.parse(md)
            : '<pre>' + esc(md) + '</pre>';
          content.dataset.loaded = '1';
        })
        .catch(function (e) {
          content.innerHTML = '<p style="color:#c0392b;">报告加载失败：' + esc(e && e.message) + '</p>';
        });
    }

    btn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    const backdrop = modal.querySelector('.report-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', close);
  }

  global.initMicroCharts = initMicroCharts;
  global.initReportModal = initReportModal;
})(window);
