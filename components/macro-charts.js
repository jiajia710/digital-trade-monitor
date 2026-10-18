/**
 * B 线（宏观数字贸易数据）可视化 —— 浅色主题 · 最小成品
 * 数据契约：参见 ../INTERFACE.md（v2 字段：china_kpi / international_comparison /
 *                              scatter_data / structure）
 * 数据示例：../data/processed/macro_kpi.json
 *
 * 依赖：全局 echarts 对象（由 index.html 通过 <script> 引入）
 */
(function (global) {
  'use strict';

  /* ====== 浅色主题色板 ====== */
  var PALETTE = {
    primary:    '#3B82F6',
    secondary:  '#0EA5A4',
    accent:     '#F59E0B',
    danger:     '#E57373',
    text:       '#1F2937',
    textSub:    '#64748B',
    textMuted:  '#94A3B8',
    axis:       '#E5E7EB',
    grid:       '#F1F5F9',
    bgCard:     '#FFFFFF',
    bgPage:     '#F5F7FA',
    markLine:   '#94A3B8',
    series:     ['#3B82F6', '#0EA5A4', '#F59E0B', '#8B5CF6', '#EC4899']
  };

  /* ====== 跨境电商进出口趋势常量数据（兜底） ====== */
  var CROSS_BORDER_CONST_DATA = {
    source: '海关总署',
    unit: '亿元',
    year_range: '2018-2025',
    trend: [
      { year: 2018, export: 6116, import: 4441, total: 10557 },
      { year: 2019, export: 7981, import: 4922, total: 12903 },
      { year: 2020, export: 10850, import: 5370, total: 16220 },
      { year: 2021, export: 13918, import: 5319, total: 19237 },
      { year: 2022, export: 15321, import: 5278, total: 20599 },
      { year: 2023, export: 18409, import: 5335, total: 23744 },
      { year: 2024, export: 21520, import: 5552, total: 27072 },
      { year: 2025, export: 22672, import: 5702, total: 28374 }
    ]
  };

  var CHART_IDS = {
    crossBorder: 'chart-cross-border',
    cnDse:       'chart-cn-dse',
    intl:        'chart-intl',
    structure:   'chart-structure'
  };

  function isMissing(v) {
    return v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  }

  function showEmpty(dom, message) {
    if (!dom) return;
    dom.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'empty-state';
    var icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.textContent = '\u26A0\uFE0F';
    var msg = document.createElement('span');
    msg.className = 'empty-msg';
    msg.textContent = message;
    box.appendChild(icon);
    box.appendChild(msg);
    dom.appendChild(box);
  }

  function baseAxis(extra) {
    return Object.assign({
      axisLine:  { lineStyle: { color: PALETTE.axis } },
      axisTick:  { lineStyle: { color: PALETTE.axis } },
      axisLabel: { color: PALETTE.textSub, fontSize: 11 },
      splitLine: { lineStyle: { color: PALETTE.grid, type: 'dashed' } }
    }, extra || {});
  }

  function baseTooltip(extra) {
    return Object.assign({
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: PALETTE.axis,
      borderWidth: 1,
      textStyle: { color: PALETTE.text, fontSize: 12 }
    }, extra || {});
  }

  /* ====== ② 中国跨境电商进出口趋势 ====== */
  function renderCrossBorder(data) {
    var dom = document.getElementById(CHART_IDS.crossBorder);
    if (!dom) return null;

    var trend = (data && Array.isArray(data.cross_border_ecommerce_trend))
      ? data.cross_border_ecommerce_trend
      : [];
    var usable = trend.filter(function (r) {
      return r && (r.year != null) && (
        Number(r.export) > 0 || Number(r.import) > 0 || Number(r.total) > 0
      );
    });
    if (usable.length < 2) {
      usable = CROSS_BORDER_CONST_DATA.trend.map(function (r) {
        return { year: r.year, export: r.export, import: r.import, total: r.total, source: CROSS_BORDER_CONST_DATA.source };
      });
    }

    function toNumOrNull(x) {
      if (x === null || x === undefined || x === '') return null;
      var n = Number(x);
      if (typeof n !== 'number' || isNaN(n)) return null;
      return n;
    }
    var years = usable.map(function (r) { return String(r.year); });
    var exportVals = usable.map(function (r) { return toNumOrNull(r.export); });
    var importVals = usable.map(function (r) { return toNumOrNull(r.import); });
    var totalVals = usable.map(function (r, i) {
      var t = toNumOrNull(r.total);
      if (t !== null) return t;
      var e = exportVals[i], m = importVals[i];
      if (e !== null && m !== null) return e + m;
      return null;
    });

    var COLOR_EXPORT = '#5470c6';
    var COLOR_IMPORT = '#ee6666';
    var COLOR_TOTAL  = '#1E3A8A';

    function fmtLineLabel(p) {
      if (p && p.value == null) return '';
      return String(p.value);
    }

    var yMax = 30000;
    try {
      var allVals = exportVals.concat(importVals).concat(totalVals)
        .filter(function (v) { return v != null; });
      if (allVals.length) {
        var maxV = Math.max.apply(null, allVals);
        yMax = Math.ceil(maxV * 1.15 / 5000) * 5000;
      }
    } catch (e) { yMax = 30000; }

    var chart = global.echarts.init(dom);
    chart.setOption({
      backgroundColor: PALETTE.bgCard,
      tooltip: baseTooltip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (params) {
          if (!params || !params.length) return '';
          var year = params[0].name;
          var lines = ['<b>' + year + ' 年</b>'];
          var hasAny = false;
          params.forEach(function (p) {
            if (p.value == null) return;
            hasAny = true;
            lines.push(p.marker + ' ' + p.seriesName + '：' + Number(p.value).toLocaleString('zh-CN') + ' 亿元');
          });
          if (!hasAny) lines.push('（该年份无数据）');
          return lines.join('<br/>');
        }
      }),
      legend: {
        data: ['出口', '进口', '进出口总额'],
        top: 8,
        itemHeight: 14,
        itemGap: 16,
        textStyle: { fontSize: 12, color: PALETTE.text }
      },
      grid: { left: '6%', right: '6%', top: 48, bottom: 50, containLabel: true },
      xAxis: baseAxis({
        type: 'category',
        name: '年份',
        nameLocation: 'middle',
        nameGap: 32,
        nameTextStyle: { color: PALETTE.textSub, fontSize: 11 },
        data: years,
        axisLabel: { color: PALETTE.textSub, fontSize: 11 }
      }),
      yAxis: [
        baseAxis({
          type: 'value',
          name: '出口/进口(亿元)',
          nameTextStyle: { color: PALETTE.textSub, fontSize: 11, padding: [0, 0, 6, 0] },
          position: 'left',
          min: 0,
          max: yMax,
          splitNumber: 6,
          splitLine: { show: false },
          axisLabel: { color: PALETTE.textSub, fontSize: 11 }
        }),
        baseAxis({
          type: 'value',
          name: '进出口总额(亿元)',
          nameTextStyle: { color: PALETTE.textSub, fontSize: 11, padding: [0, 0, 6, 0] },
          position: 'right',
          min: 0,
          max: yMax,
          splitNumber: 6,
          splitLine: { show: false },
          axisLabel: { color: PALETTE.textSub, fontSize: 11 }
        })
      ],
      series: [
        {
          name: '出口',
          type: 'bar',
          data: exportVals,
          yAxisIndex: 0,
          barWidth: 14,
          itemStyle: { color: COLOR_EXPORT, borderRadius: [3, 3, 0, 0] },
          label: { show: false },
          emphasis: { focus: 'series' }
        },
        {
          name: '进口',
          type: 'bar',
          data: importVals,
          yAxisIndex: 0,
          barWidth: 14,
          itemStyle: { color: COLOR_IMPORT, borderRadius: [3, 3, 0, 0] },
          label: { show: false },
          emphasis: { focus: 'series' }
        },
        {
          name: '进出口总额',
          type: 'line',
          data: totalVals,
          yAxisIndex: 1,
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: true,
          connectNulls: false,
          lineStyle: { width: 2, color: COLOR_TOTAL },
          itemStyle: { color: COLOR_TOTAL, borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            position: 'top',
            color: COLOR_TOTAL,
            fontSize: 11,
            fontWeight: 600,
            formatter: fmtLineLabel
          },
          labelLayout: { hideOverlap: true },
          z: 3
        }
      ]
    });
    return chart;
  }

  /* ====== ③ 中国数字交付服务贸易趋势 ====== */
  function renderCnDse(data) {
    var dom = document.getElementById(CHART_IDS.cnDse);
    if (!dom) return null;

    var rawSeries = Array.isArray(data.china_digital_service_trend)
      ? data.china_digital_service_trend
      : [];
    var ts = rawSeries
      .filter(function (p) {
        return p && !isMissing(p.year) && !isMissing(p.value);
      })
      .map(function (p) {
        return { year: Number(p.year), value: Number(p.value) };
      })
      .sort(function (a, b) { return a.year - b.year; });

    if (ts.length < 2) {
      showEmpty(
        dom,
        '中国数字交付服务贸易时序不足（< 2 个有效年度点），' +
        '无法渲染折线趋势图。当前共 ' + ts.length + ' 个点。' +
        '（数据源：WTO Timeseries API ITS_CS_AM6，SI+SH 口径）'
      );
      return null;
    }

    var years  = ts.map(function (p) { return String(p.year); });
    var valuesYi = ts.map(function (p) { return Number(p.value) / 100.0; });
    var firstY = ts[0].year;
    var lastY  = ts[ts.length - 1].year;
    var yearRange = firstY + '–' + lastY;
    var updatedAt = (data && data.updated_at) ? data.updated_at : '?';

    var allValues = valuesYi.filter(function (v) { return isFinite(v); });
    var yMin = 0, yMax = 1000;
    if (allValues.length > 0) {
      var dMin = Math.min.apply(null, allValues);
      var dMax = Math.max.apply(null, allValues);
      var span = dMax - dMin || dMax || 1;
      yMin = Math.max(0, Math.floor((dMin - span * 0.10) / 100) * 100);
      yMax = Math.ceil((dMax + span * 0.10) / 100) * 100;
    }

    var chart = global.echarts.init(dom);
    chart.setOption({
      backgroundColor: PALETTE.bgCard,
      color: [PALETTE.primary],
      tooltip: baseTooltip({
        trigger: 'axis',
        formatter: function (params) {
          var p = params && params[0];
          if (!p) return '';
          return [
            p.name + ' 年',
            '数字交付服务贸易（SI+SH）：' +
              Number(p.value).toLocaleString('en-US', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
              }) + ' 亿美元',
            '口径：EBOPS-2010 SI + SH（百万美元 ÷100）'
          ].join('<br/>');
        }
      }),
      grid: { left: '8%', right: '6%', top: 28, bottom: 50, containLabel: true },
      xAxis: baseAxis({
        type: 'category',
        name: '年份（年度数据）',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: PALETTE.textSub, fontSize: 11 },
        data: years,
        axisLabel: { color: PALETTE.textSub, fontSize: 11 }
      }),
      yAxis: baseAxis({
        type: 'value',
        name: '亿美元',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: { color: PALETTE.textSub, fontSize: 11, align: 'right' },
        min: yMin,
        max: yMax,
        axisLabel: {
          color: PALETTE.textSub,
          fontSize: 11,
          formatter: function (v) {
            return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
          }
        }
      }),
      series: [{
        name: '数字交付服务贸易（SI+SH）',
        type: 'line',
        data: valuesYi,
        smooth: false,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: true,
        lineStyle: { width: 2.5, color: PALETTE.primary },
        itemStyle: { color: PALETTE.primary, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          position: 'top',
          color: PALETTE.textSub,
          fontSize: 10,
          formatter: function (p) {
            return Number(p.value).toLocaleString('en-US', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            });
          }
        }
      }]
    });
    return chart;
  }

  /* ====== ④ 国际比较：横向条形图 ====== */
  function renderIntl(data) {
    var dom = document.getElementById(CHART_IDS.intl);
    if (!dom) return null;
    var ic = Array.isArray(data.international_comparison) ? data.international_comparison : [];
    if (ic.length === 0) {
      showEmpty(dom, '国际比较数据缺失（international_comparison 为空）。');
      return null;
    }
    var rows = ic
      .filter(function (r) { return r && !isMissing(r.ict_export_share); })
      .map(function (r) {
        return { country: r.country, value: Number(r.ict_export_share) };
      })
      .sort(function (a, b) { return a.value - b.value; });
    if (rows.length === 0) {
      showEmpty(dom, '国际比较数据缺失：所有国家均无有效 ICT 占比。');
      return null;
    }

    var chart = global.echarts.init(dom);
    var categories = rows.map(function (r) { return r.country; });
    var values     = rows.map(function (r) { return r.value; });
    var colors     = rows.map(function (_, idx) {
      return PALETTE.series[idx % PALETTE.series.length];
    });

    chart.setOption({
      backgroundColor: PALETTE.bgCard,
      tooltip: baseTooltip({
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: function (params) {
          var p = params && params[0];
          if (!p) return '';
          return p.name + '<br/>ICT 服务出口占比：' + Number(p.value).toFixed(1) + '%';
        }
      }),
      grid: { left: '4%', right: '14%', top: 24, bottom: 44, containLabel: true },
      xAxis: baseAxis({
        type: 'value',
        name: 'ICT 服务出口占比 (%)',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: PALETTE.textSub, fontSize: 11 },
        axisLabel: { color: PALETTE.textSub, fontSize: 11, formatter: '{value}%' }
      }),
      yAxis: baseAxis({
        type: 'category',
        name: '国家',
        nameLocation: 'middle',
        nameGap: 60,
        nameTextStyle: { color: PALETTE.textSub, fontSize: 11 },
        data: categories,
        axisLabel: { color: PALETTE.text, fontSize: 12, fontWeight: 600 }
      }),
      series: [{
        name: 'ICT 服务出口占比',
        type: 'bar',
        data: values.map(function (v, i) {
          return { value: v, itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] } };
        }),
        barWidth: '46%',
        label: {
          show: true,
          position: 'right',
          color: PALETTE.text,
          fontSize: 12,
          fontWeight: 600,
          formatter: function (p) { return Number(p.value).toFixed(1) + '%'; }
        }
      }]
    });
    return chart;
  }

  /* ====== ⑤ 数字服务贸易结构（环形图） ====== */
  function renderStructure(data) {
    var dom = document.getElementById(CHART_IDS.structure);
    if (!dom) return null;

    var primary = Array.isArray(data.structure) ? data.structure : [];
    var primaryUsable = primary.filter(function (s) {
      return s && !isMissing(s.value) && Number(s.value) > 0
        && !isMissing(s.category == null ? s.name : s.category);
    });
    
    var usable = primaryUsable;
    var isFallback = false;
    if (usable.length === 0) {
      var legacy = Array.isArray(data.structure_legacy_2024)
        ? data.structure_legacy_2024 : [];
      var legacyUsable = legacy.filter(function (s) {
        return s && !isMissing(s.value) && Number(s.value) > 0
          && !isMissing(s.category);
      });
      if (legacyUsable.length === 0) {
        showEmpty(
          dom,
          '官方暂未提供分类明细，无法渲染环图。' +
          '（structure 与 structure_legacy_2024 均为空）'
        );
        return null;
      }
      usable = legacyUsable;
      isFallback = true;
    }

    var sm = isFallback
      ? ((data && data.structure_meta_legacy_2024) || {})
      : ((data && data.structure_meta) || {});
    var yearLabel = !isMissing(sm.year) ? String(sm.year) : '—';
    var unitLabel = sm.unit || '百万美元';
    var counterpartLabel = sm.counterpart || '—';

    var chart = global.echarts.init(dom);

    var pieData = usable.map(function (s, i) {
      var label = s.category == null ? s.name : s.category;
      return {
        name: String(label),
        value: Number(s.value),
        _share: isMissing(s.share) ? null : Number(s.share),
        _code: s.category_code || '',
        itemStyle: { color: PALETTE.series[i % PALETTE.series.length] }
      };
    });

    var sortedByValue = pieData.slice().sort(function (a, b) {
      return (Number(b.value) || 0) - (Number(a.value) || 0);
    });
    var topN = 3;
    var topNames = {};
    for (var ti = 0; ti < Math.min(topN, sortedByValue.length); ti++) {
      topNames[sortedByValue[ti].name] = true;
    }

    function fmtVal(v) {
      var n = Number(v);
      if (!isFinite(n)) return '-';
      return n.toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }) + ' 百万美元';
    }
    function fmtShare(s) {
      if (s == null || !isFinite(Number(s))) return '—';
      return Number(s).toFixed(1) + '%';
    }

    chart.setOption({
      backgroundColor: PALETTE.bgCard,
      tooltip: baseTooltip({
        trigger: 'item',
        formatter: function (params) {
          var d = params.data || {};
          var share = d._share;
          var code = d._code;
          var lines = [
            '<b>' + params.name + '</b>' + (code ? ' (' + code + ')' : ''),
            '金额：' + fmtVal(params.value),
            '占比：' + fmtShare(share),
            '时间：' + yearLabel,
            '口径：' + counterpartLabel
          ];
          return lines.join('<br/>');
        }
      }),
      legend: {
        orient: 'vertical',
        right: '4%',
        bottom: '6%',
        itemHeight: 11,
        itemGap: 6,
        textStyle: { color: PALETTE.textSub, fontSize: 12 }
      },
      graphic: [
        {
          type: 'text',
          // 【修改点】用最纯粹的百分比进行微调，放弃原有复杂的像素计算
          left: '39%', 
          top: '48%',
          style: {
            text: yearLabel + '年',
            fill: PALETTE.text,
            fontSize: 14,
            fontWeight: 600,
            textAlign: 'center',
            textVerticalAlign: 'middle',
            lineHeight: 18
          }
        }
      ],
      series: [
        {
          name: '结构占比',
          type: 'pie',
          radius: ['38%', '62%'],
          center: ['42%', '50%'], // 【修改点】让圆心稍微偏左，以避开右侧图例
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            position: 'outside',
            color: PALETTE.text,
            fontSize: 11,
            fontWeight: 600,
            formatter: function (params) {
              if (!topNames[params.name]) return '';
              var d = params.data || {};
              var share = d._share;
              if (share == null) return params.name;
              return params.name + '\n' + Number(share).toFixed(1) + '%';
            }
          },
          labelLine: {
            show: true,
            length: 10,
            length2: 4
          },
          labelLayout: {
            hideOverlap: true,
            moveOverlap: 'shiftY'
          },
          data: pieData
        }
      ]
    });
    return chart;
  }

  /* ====== 入口：渲染 4 块图表 ====== */
  function renderMacroCharts(domId, data) {
    if (!data || typeof data !== 'object') {
      console.error('[renderMacroCharts] invalid data');
      return null;
    }
    if (typeof global.echarts === 'undefined') {
      console.error('[renderMacroCharts] echarts is not loaded globally');
      return null;
    }

    var charts = [];
    var c1 = renderCrossBorder(data); if (c1) charts.push(c1);
    var c2 = renderCnDse(data);       if (c2) charts.push(c2);
    var c3 = renderIntl(data);        if (c3) charts.push(c3);
    var c4 = renderStructure(data);   if (c4) charts.push(c4);

    if (typeof global.addEventListener === 'function') {
      var resizeHandler = function () {
        charts.forEach(function (c) { if (c) c.resize(); });
      };
      global.addEventListener('resize', resizeHandler);
    }
    return { charts: charts, ids: CHART_IDS };
  }

  global.renderMacroCharts = renderMacroCharts;
  global.MACRO_CHART_IDS   = CHART_IDS;
  global.MACRO_CONST_DATA  = {
    crossBorder: CROSS_BORDER_CONST_DATA
  };
})(typeof window !== 'undefined' ? window : globalThis);