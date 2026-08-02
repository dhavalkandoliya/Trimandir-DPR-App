'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  Filler,
  Tooltip,
} from 'chart.js';
import ErrorBoundary from '../ui/ErrorBoundary';

Chart.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  LineController, BarController, Filler, Tooltip
);

const CONDITION_EMOJI = { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', 'Site Closed': '🚧', Holiday: '🎉' };

function toYMD(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  return s;
}

function formatShortDate(ymd) {
  const parts = ymd.split('-');
  return `${parts[2]}/${parts[1]}`;
}

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  if (h.length !== 3 && h.length !== 6) return `rgba(79, 70, 229, ${alpha})`;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const bigint = parseInt(full, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Portal-mounted React replacement for the legacy renderDashboard()/setPeriod()
// vanilla-JS dashboard. Reads _history/_projects via the read-only window.*
// accessors exposed by index.html's script, and stays in sync via the
// 'dpr:historyUpdated'/'dpr:themeChanged' custom events dispatched there —
// see index.html's DASHBOARD section comment for the bridge contract.
export default function AnalyticsDashboard() {
  const [mountNode, setMountNode] = useState(null);
  const [period, setPeriod] = useState('week');
  const [dataVersion, setDataVersion] = useState(0);
  const [themeVersion, setThemeVersion] = useState(0);
  const [openSites, setOpenSites] = useState(() => new Set());
  const [openSubs, setOpenSubs] = useState(() => new Set());

  const trendCanvasRef = useRef(null);
  const siteCanvasRef = useRef(null);
  const trendChartRef = useRef(null);
  const siteChartRef = useRef(null);

  // Defensive poll for the legacy-injected mount div — app/page.js injects the
  // compiled HTML in its own useEffect with no ordering guarantee vs. this one.
  useEffect(() => {
    let cancelled = false;
    const tryFind = () => {
      const el = document.getElementById('__dashboard_mount__');
      if (el) { if (!cancelled) setMountNode(el); return true; }
      return false;
    };
    if (tryFind()) return undefined;
    const interval = setInterval(() => { if (tryFind()) clearInterval(interval); }, 200);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const onHistory = () => setDataVersion(v => v + 1);
    const onTheme = () => setThemeVersion(v => v + 1);
    window.addEventListener('dpr:historyUpdated', onHistory);
    window.addEventListener('dpr:themeChanged', onTheme);
    return () => {
      window.removeEventListener('dpr:historyUpdated', onHistory);
      window.removeEventListener('dpr:themeChanged', onTheme);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => (
    (typeof window !== 'undefined' && window.__getHistory) ? window.__getHistory() : []
  ), [dataVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => (
    (typeof window !== 'undefined' && window.__getProjects) ? window.__getProjects() : []
  ), [dataVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const materials = useMemo(() => (
    (typeof window !== 'undefined' && window.__getMaterials) ? window.__getMaterials() : []
  ), [dataVersion]);

  const periodData = useMemo(() => {
    if (!history.length) return [];
    const now = new Date();
    return history.filter(item => {
      const ymd = toYMD(item.date);
      if (!ymd || ymd.length < 10) return period === 'all';
      const [yr, mo, da] = ymd.split('-').map(Number);
      const d = new Date(yr, mo - 1, da);
      if (period === 'week') {
        const day = now.getDay() || 7;
        const mon = new Date(now); mon.setDate(now.getDate() - day + 1); mon.setHours(0, 0, 0, 0);
        return d >= mon;
      }
      if (period === 'month') return mo === now.getMonth() + 1 && yr === now.getFullYear();
      return true;
    });
  }, [history, period]);

  const stats = useMemo(() => {
    const totalW = periodData.reduce((a, i) => a + (Number(i.total) || 0), 0);
    const totalD = periodData.length;
    const avgW = totalD ? Math.round(totalW / totalD) : 0;
    const activeSites = new Set(periodData.map(i => i.site).filter(Boolean)).size;
    return { totalW, totalD, avgW, activeSites };
  }, [periodData]);

  // Work-completion %: sum(actual) / sum(plannedQty) across activity-detail
  // rows in the period. plannedQty is optional per row (added in Phase 5), so
  // this is null (not 0%) whenever nobody has entered a planned quantity yet.
  const completion = useMemo(() => {
    let actual = 0, planned = 0;
    periodData.forEach(item => {
      (Array.isArray(item.details) ? item.details : []).forEach(det => {
        const p = Number(det.plannedQty) || 0;
        if (p > 0) {
          planned += p;
          actual += Number(det.total) || (Number(det.skilled) || 0) + (Number(det.unskilled) || 0);
        }
      });
    });
    return planned > 0 ? Math.round((actual / planned) * 100) : null;
  }, [periodData]);

  // Material usage vs budget for the period — flags anything over its
  // budgeted quantity (0 = no budget set, treated as "no alert possible").
  const materialUsage = useMemo(() => {
    const used = {};
    periodData.forEach(item => {
      (Array.isArray(item.materialsUsed) ? item.materialsUsed : []).forEach(m => {
        const name = m.material_name || m.name;
        if (!name) return;
        used[name] = (used[name] || 0) + (Number(m.qty) || 0);
      });
    });
    return materials
      .filter(m => m.status !== 'inactive')
      .map(m => {
        const usedQty = used[m.material_name] || 0;
        const budget = Number(m.budget_qty) || 0;
        return {
          name: m.material_name,
          unit: m.unit || '',
          used: usedQty,
          budget,
          overBudget: budget > 0 && usedQty > budget,
        };
      })
      .filter(m => m.used > 0 || m.budget > 0)
      .sort((a, b) => (b.overBudget ? 1 : 0) - (a.overBudget ? 1 : 0) || b.used - a.used);
  }, [periodData, materials]);

  // Week-over-week / month-over-month deltas: current window vs. the
  // immediately preceding equal-length window, pure client-side math.
  const trends = useMemo(() => {
    if (period === 'all' || !history.length) return null;
    const now = new Date();
    let curStart, curEnd, prevStart, prevEnd;
    if (period === 'week') {
      const day = now.getDay() || 7;
      curStart = new Date(now); curStart.setDate(now.getDate() - day + 1); curStart.setHours(0, 0, 0, 0);
      curEnd = new Date(now); curEnd.setHours(23, 59, 59, 999);
      prevEnd = new Date(curStart);
      prevStart = new Date(curStart); prevStart.setDate(prevStart.getDate() - 7);
    } else {
      curStart = new Date(now.getFullYear(), now.getMonth(), 1);
      curEnd = new Date(now); curEnd.setHours(23, 59, 59, 999);
      prevEnd = new Date(curStart);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    }
    const agg = (start, end) => {
      const items = history.filter(item => {
        const ymd = toYMD(item.date);
        if (!ymd || ymd.length < 10) return false;
        const [yr, mo, da] = ymd.split('-').map(Number);
        const d = new Date(yr, mo - 1, da);
        return d >= start && d < end;
      });
      const totalW = items.reduce((a, i) => a + (Number(i.total) || 0), 0);
      return { totalW, totalD: items.length };
    };
    const cur = agg(curStart, curEnd);
    const prev = agg(prevStart, prevEnd);
    const pct = (c, p) => (p ? Math.round(((c - p) / p) * 100) : null);
    return {
      totalW: pct(cur.totalW, prev.totalW),
      totalD: pct(cur.totalD, prev.totalD),
      avgW: pct(cur.totalD ? cur.totalW / cur.totalD : 0, prev.totalD ? prev.totalW / prev.totalD : 0),
    };
  }, [history, period]);

  const conditionCounts = useMemo(() => {
    const counts = {};
    periodData.forEach(i => { if (i.siteCondition) counts[i.siteCondition] = (counts[i.siteCondition] || 0) + 1; });
    return counts;
  }, [periodData]);

  // Site -> sub-site -> activity manpower breakdown, using the same project
  // parent_id hierarchy lookup as the legacy renderDashboard() did.
  const mainMap = useMemo(() => {
    const projMap = {};
    projects.forEach(p => { projMap[String(p.project_name).trim()] = p; });
    const projById = {};
    projects.forEach(p => { projById[String(p.id).trim()] = p; });

    const map = {};
    periodData.forEach(item => {
      const siteName = item.site ? String(item.site).trim() : 'Unknown';
      const p = projMap[siteName];
      let mainName = siteName;
      let subName = '';
      if (p) {
        const parentIdStr = p.parent_id ? String(p.parent_id).trim() : '';
        if (parentIdStr && projById[parentIdStr]) {
          mainName = projById[parentIdStr].project_name;
          subName = p.project_name;
        }
      }
      if (!map[mainName]) map[mainName] = { total: 0, hasSubs: false, subs: {} };
      map[mainName].total += Number(item.total) || 0;
      if (subName) map[mainName].hasSubs = true;
      if (!map[mainName].subs[subName]) map[mainName].subs[subName] = { total: 0, activities: {} };
      map[mainName].subs[subName].total += Number(item.total) || 0;

      const details = Array.isArray(item.details) ? item.details : [];
      details.forEach(det => {
        const actName = det.activity || 'Unknown';
        const actTotal = Number(det.total) || (Number(det.skilled) || 0) + (Number(det.unskilled) || 0);
        map[mainName].subs[subName].activities[actName] = (map[mainName].subs[subName].activities[actName] || 0) + actTotal;
      });
    });
    return map;
  }, [periodData, projects]);

  const sortedSites = useMemo(
    () => Object.entries(mainMap).sort((a, b) => b[1].total - a[1].total),
    [mainMap]
  );
  const maxSiteTotal = Math.max(...sortedSites.map(([, d]) => d.total), 1);
  const topSites = useMemo(() => sortedSites.slice(0, 8), [sortedSites]);

  // Per-day manpower totals within the period, for the trend line chart.
  const dailySeries = useMemo(() => {
    const byDay = {};
    periodData.forEach(item => {
      const ymd = toYMD(item.date);
      if (!ymd || ymd.length < 10) return;
      byDay[ymd] = (byDay[ymd] || 0) + (Number(item.total) || 0);
    });
    return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  }, [periodData]);

  // ── Trend line chart: single series -> one hue (accent), no legend needed ──
  useEffect(() => {
    if (!trendCanvasRef.current) return undefined;
    const accent = cssVar('--accent', '#4f46e5');
    const muted = cssVar('--muted', '#6b7280');
    const border = cssVar('--border', '#e3e5f0');
    const card = cssVar('--card', '#ffffff');

    if (trendChartRef.current) trendChartRef.current.destroy();
    trendChartRef.current = new Chart(trendCanvasRef.current, {
      type: 'line',
      data: {
        labels: dailySeries.map(([d]) => formatShortDate(d)),
        datasets: [{
          data: dailySeries.map(([, w]) => w),
          borderColor: accent,
          backgroundColor: hexToRgba(accent, 0.1),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 5,
          pointBackgroundColor: accent,
          pointBorderColor: card,
          pointBorderWidth: 2,
          fill: true,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: border }, ticks: { color: muted, font: { size: 10 } } },
        },
      },
    });

    return () => { if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; } };
  }, [dailySeries, themeVersion]);

  // ── Site breakdown bar chart: magnitude comparison -> one hue, length encodes value ──
  useEffect(() => {
    if (!siteCanvasRef.current) return undefined;
    const accent = cssVar('--accent', '#4f46e5');
    const muted = cssVar('--muted', '#6b7280');
    const border = cssVar('--border', '#e3e5f0');

    if (siteChartRef.current) siteChartRef.current.destroy();
    siteChartRef.current = new Chart(siteCanvasRef.current, {
      type: 'bar',
      data: {
        labels: topSites.map(([name]) => name),
        datasets: [{
          data: topSites.map(([, d]) => d.total),
          backgroundColor: accent,
          borderRadius: 4,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: border }, ticks: { color: muted, font: { size: 10 } } },
          y: { grid: { display: false }, ticks: { color: muted, font: { size: 11 } } },
        },
      },
    });

    return () => { if (siteChartRef.current) { siteChartRef.current.destroy(); siteChartRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSites, themeVersion]);

  if (!mountNode) return null;

  const toggleSite = (name) => setOpenSites(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleSub = (key) => setOpenSubs(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const trendBadge = (pct) => {
    if (pct === null || pct === undefined) return null;
    const cls = pct === 0 ? 'trend-badge trend-flat' : pct > 0 ? 'trend-badge trend-up' : 'trend-badge trend-down';
    const label = pct === 0 ? '— 0%' : pct > 0 ? `▲ ${pct}%` : `▼ ${Math.abs(pct)}%`;
    return <span className={cls}>{label}</span>;
  };

  const conditionSummary = Object.entries(conditionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cond, n]) => `${CONDITION_EMOJI[cond] || ''} ${n} ${cond} day${n === 1 ? '' : 's'}`)
    .join('  ·  ');

  return createPortal(
    <ErrorBoundary>
      <div className="card">
        <div className="section-title">📊 Summary Dashboard</div>
        <div className="period-tabs">
          <button className={`period-tab${period === 'week' ? ' active' : ''}`} onClick={() => setPeriod('week')}>This Week</button>
          <button className={`period-tab${period === 'month' ? ' active' : ''}`} onClick={() => setPeriod('month')}>This Month</button>
          <button className={`period-tab${period === 'all' ? ' active' : ''}`} onClick={() => setPeriod('all')}>All Time</button>
        </div>
        <div className="dash-grid">
          <div className="dash-stat"><span className="dash-stat-icon">👷</span><div className="num">{stats.totalW}</div><div className="lbl">Total Workers</div>{trends && trendBadge(trends.totalW)}</div>
          <div className="dash-stat"><span className="dash-stat-icon">📋</span><div className="num">{stats.totalD}</div><div className="lbl">Total DPRs</div>{trends && trendBadge(trends.totalD)}</div>
          <div className="dash-stat"><span className="dash-stat-icon">📈</span><div className="num">{stats.avgW}</div><div className="lbl">Avg / Day</div>{trends && trendBadge(trends.avgW)}</div>
          <div className="dash-stat"><span className="dash-stat-icon">🏗️</span><div className="num">{stats.activeSites}</div><div className="lbl">Active Sites</div></div>
          {completion !== null && (
            <div className="dash-stat"><span className="dash-stat-icon">🎯</span><div className="num">{completion}%</div><div className="lbl">Work Completion</div></div>
          )}
        </div>
        {conditionSummary && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{conditionSummary}</div>}

        {dailySeries.length > 1 && (
          <>
            <div className="section-title" style={{ marginTop: 4 }}>📈 Manpower Trend</div>
            <div style={{ height: 180, marginBottom: 16 }}>
              <canvas ref={trendCanvasRef} />
            </div>
          </>
        )}

        {topSites.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 4 }}>📍 Site Manpower Comparison</div>
            <div style={{ height: Math.max(120, topSites.length * 32), marginBottom: 16 }}>
              <canvas ref={siteCanvasRef} />
            </div>
          </>
        )}

        <div className="section-title" style={{ marginTop: 4 }}>📍 Site-wise Manpower (Detail)</div>
        <div>
          {sortedSites.length === 0 && <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center' }}>No data for this period</p>}
          {sortedSites.map(([mainName, mainData]) => {
            const isOpen = openSites.has(mainName);
            return (
              <div key={mainName} style={{ marginBottom: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div className="site-row" style={{ marginBottom: 0, background: 'transparent', border: 'none', padding: 12, cursor: 'pointer' }} onClick={() => toggleSite(mainName)}>
                  <div style={{ fontSize: 14, fontWeight: 700, flex: '0 0 auto', maxWidth: '55%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📍 {mainName}</div>
                  <div className="bar-wrap"><div className="bar-fill" style={{ width: `${Math.round(mainData.total / maxSiteTotal * 100)}%` }} /></div>
                  <div className="site-total" style={{ fontWeight: 700 }}>{mainData.total}</div>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-subtle)' }}>
                    <div style={{ marginTop: 8 }}>
                      {mainData.hasSubs
                        ? Object.entries(mainData.subs).sort((a, b) => b[1].total - a[1].total).map(([subName, subData]) => {
                          const subKey = `${mainName}||${subName}`;
                          const subOpen = openSubs.has(subKey);
                          return (
                            <div key={subKey} style={{ marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', cursor: 'pointer', background: 'var(--primary-light)', borderRadius: 6 }} onClick={() => toggleSub(subKey)}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>{subName ? `↳ ${subName}` : '↳ General / Direct'}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{subData.total}</span>
                              </div>
                              {subOpen && (
                                <div style={{ marginTop: 4 }}>
                                  {Object.entries(subData.activities).sort((a, b) => b[1] - a[1]).map(([act, actW]) => (
                                    <div key={act} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 4px 28px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px dashed var(--border)' }}>
                                      <span>{act}</span>
                                      <span style={{ fontWeight: 600 }}>{actW}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                        : Object.entries((mainData.subs[''] || { activities: {} }).activities).sort((a, b) => b[1] - a[1]).map(([act, actW]) => (
                          <div key={act} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 4px 18px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px dashed var(--border)' }}>
                            <span>↳ {act}</span>
                            <span style={{ fontWeight: 600 }}>{actW}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {materialUsage.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 16 }}>🧱 Material Usage</div>
            <div>
              {materialUsage.map(m => (
                <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', marginBottom: 6, borderRadius: 8, border: '1px solid var(--border)', background: m.overBudget ? 'rgba(239,68,68,0.08)' : 'var(--surface-subtle)' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.overBudget ? '⚠️ ' : ''}{m.name}</span>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Used: {m.used}{m.unit ? ` ${m.unit}` : ''}{m.budget > 0 ? ` / Budget: ${m.budget}${m.unit ? ` ${m.unit}` : ''}` : ' (no budget set)'}
                    </div>
                  </div>
                  {m.overBudget && <span className="trend-badge trend-down">Over budget</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>,
    mountNode
  );
}
