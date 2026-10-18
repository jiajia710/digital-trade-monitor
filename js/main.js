/**
 * 宏观模块（B 线 · 数字贸易）本地预览入口
 * 数据契约：macro_kpi.json  v2 字段：china_kpi / international_comparison /
 *                                 scatter_data / structure
 * 组件契约：components/macro-charts.js 暴露的 window.renderMacroCharts
 *
 * 流程：
 *   1. fetch data/processed/macro_kpi.json
 *   2. 顶部 4 个 KPI 卡：直接填 DOM（不走 echarts）
 *   3. 4 块图表：交给 components/macro-charts.js 渲染
 */
(function () {
  'use strict';

  function setStatus(text, kind) {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status ' + (kind || '');
  }

  function showError(msg) {
    console.error('[B 预览]', msg);
    setStatus('加载失败：' + msg, 'error');
  }

  function isMissing(v) {
    return v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  }

  /* ===== 顶部 3 个 KPI 卡：直接填 DOM，主数值全部动态绑定 =====
   *   无数据绝不显示 0/undefined/null，全部降级为 "—" + .muted。
   *   数据源约定（与图表组件保持一致，无数据时降级到兜底常量）：
   *   - KPI 1 跨境电商进出口总额：data.cross_border_ecommerce_trend 末年 total
   *       （缺失则用 window.MACRO_CONST_DATA.crossBorder.trend，海关总署 2018-2025）
   *   - KPI 2 数字交付服务贸易额：data.china_digital_service_trend 末年 value（百万美元）
   *   - KPI 3 ICT 服务出口占比：data.international_comparison 中 CHN 行的 ict_export_share
   */
  function fillTopKpis(data) {
    // ---- KPI 1: 跨境电商进出口总额 ----
    //   单位：亿元 → 万元亿。优先 JSON，回退到 macro-charts.js 暴露的兜底常量。
    var cb = document.getElementById('kpi-cross-border');
    if (cb) {
      var picked = pickLatestTotal(data && data.cross_border_ecommerce_trend);
      if (!picked && typeof window !== 'undefined'
          && window.MACRO_CONST_DATA
          && window.MACRO_CONST_DATA.crossBorder
          && Array.isArray(window.MACRO_CONST_DATA.crossBorder.trend)) {
        picked = pickLatestTotal(window.MACRO_CONST_DATA.crossBorder.trend);
      }
      if (!picked) {
        cb.textContent = '—';
        cb.classList.add('muted');
      } else {
        // 兜底常量中 total 单位为亿元；JSON 如有不同口径需告知前端适配
        var trillion = Number(picked.total) / 10000;
        cb.textContent = trillion.toFixed(2) + ' 万亿元';
        cb.classList.remove('muted');
      }
    }

    // ---- KPI 2: 数字交付服务贸易额 ----
    //   取 china_digital_service_trend 末年 value，单位：百万美元 → 亿美元
    var dse = document.getElementById('kpi-dse-trade');
    if (dse) {
      var arr = (data && Array.isArray(data.china_digital_service_trend))
        ? data.china_digital_service_trend : [];
      var last2 = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].value != null && !isNaN(Number(arr[i].value))) {
          last2 = arr[i];   // 数组通常按年份升序，最后一项即为最新
        }
      }
      if (!last2) {
        dse.textContent = '—';
        dse.classList.add('muted');
      } else {
        var yiUsd = Number(last2.value) / 100;   // 百万 → 亿
        dse.textContent = yiUsd.toFixed(1) + ' 亿美元';
        dse.classList.remove('muted');
      }
    }

    // ---- KPI 3: ICT 服务出口占比 ----
    //   取 international_comparison 中 country==='China' (或 code='CHN') 的 ict_export_share
    var ict = document.getElementById('kpi-ict-share');
    if (ict) {
      var ic = Array.isArray(data.international_comparison) ? data.international_comparison : [];
      var cn = null;
      for (var k = 0; k < ic.length; k++) {
        if (ic[k] && (ic[k].country_code === 'CHN' || ic[k].country === 'China')) {
          cn = ic[k]; break;
        }
      }
      if (!cn || isMissing(cn.ict_export_share)) {
        ict.textContent = '—';
        ict.classList.add('muted');
      } else {
        // 只显示百分比 "19.1%"，不再拼接年份（年份信息已在卡脚 "世界银行 BX.GSR.CCIS.ZS，2025年" 中体现）
        ict.textContent = Number(cn.ict_export_share).toFixed(1) + '%';
        ict.classList.remove('muted');
      }
    }
  }

  /* 工具：从跨境电商趋势数组中挑出"年份最大且 total 有效"的那一年。
   *   返回 { year, total } 或 null。 */
  function pickLatestTotal(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.year == null || r.total == null) continue;
      var t = Number(r.total);
      if (!isFinite(t)) continue;            // null/NaN 跳过
      if (best === null || Number(r.year) > Number(best.year)) {
        best = { year: r.year, total: t };
      }
    }
    return best;
  }

  function bootstrap() {
    if (typeof window.echarts === 'undefined') {
      showError('ECharts 未加载，请确认 lib/echarts.min.js 已存在并在 index.html 中引入。');
      return;
    }
    if (typeof window.renderMacroCharts !== 'function') {
      showError('components/macro-charts.js 未正确加载（找不到 window.renderMacroCharts）。');
      return;
    }

    var dataUrl = 'data/processed/macro_kpi.json';
    setStatus('正在加载 ' + dataUrl + ' ...', 'loading');

    fetch(dataUrl, { cache: 'no-cache' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
        return resp.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object') {
          throw new Error('返回数据不是合法 JSON 对象');
        }

        // ① 顶部 KPI 卡
        try { fillTopKpis(data); }
        catch (e) { console.error('[B 预览] 顶部 KPI 填值失败：', e); }

        // ②③④⑤ 4 块图表
        try {
          window.renderMacroCharts('macro-charts', data);
        } catch (e) {
          showError('渲染失败：' + (e && e.message ? e.message : String(e)));
          return;
        }

        var nIntl = Array.isArray(data.international_comparison) ? data.international_comparison.length : 0;
        var nStruct = Array.isArray(data.structure) ? data.structure.length : 0;
        // 顶部状态条已移除 updated_at（与第 3 张 KPI 卡片「最新数据期」信息重复）。
        setStatus(
          '数据已加载 · 国际比较 ' + nIntl + ' 国' +
          ' · 结构数据 ' + nStruct + ' 条',
          'ok'
        );
      })
      .catch(function (err) {
        showError(err && err.message ? err.message : String(err));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
