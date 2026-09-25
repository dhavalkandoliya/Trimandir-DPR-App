'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
} from 'chart.js';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { CONDITIONS, conditionClass, recordActivities } from '../../lib/report/reportModel';

Chart.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip);

const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

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
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  if (h.length !== 3 && h.length !== 6) return `rgba(31, 78, 121, ${alpha})`;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Skilled / unskilled split of a record, from its activity rows. Older
// records without rows count their whole total as unskilled.
function splitOf(item) {
  let sk = 0, un = 0;
  recordActivities(item).forEach(a => { sk += Number(a.skilled) || 0; un += Number(a.unskilled) || 0; });
  const total = Number(item.total) || 0;
  if (!sk && !un && total) un = total;
  return { sk, un };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function HBars({ rows, empty }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([name, val]) => (
    <div key={name} className="hbar">
      <span title={name}>{name}</span>
      <div className="track"><div className="fill" style={{ width: `${(val / max) * 100}%` }} /></div>
      <b>{fmt(val)}</b>
    </div>
  ));
}

// Dashboard: period KPIs, daily manpower chart, conditions, site and
// activity mix, and the per-site drill-down.
export default function AnalyticsDashboard() {
  const { history, projects, theme } = useApp();
  const [period, setPeriod] = useState('week');
  const [openSites, setOpenSites] = useState(() => new Set());
  const [openSubs, setOpenSubs] = useState(() => new Set());

  const chartCanvasRef = useRef(null);
  const chartRef = useRef(null);

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
  // rows in the period. plannedQty is optional per row, so this is null
  // (not 0%) whenever nobody has entered a planned quantity yet.
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

  const activityMix = useMemo(() => {
    const mix = {};
    periodData.forEach(item => recordActivities(item).forEach(a => {
      const k = String(a.main_activity || a.activity || 'Other').trim();
      mix[k] = (mix[k] || 0) + (Number(a.skilled) || 0) + (Number(a.unskilled) || 0);
    }));
    return Object.entries(mix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [periodData]);

  // Site -> sub-site -> activity manpower breakdown, via the projects'
  // parent_id hierarchy.
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

  // Per-day skilled/unskilled totals within the period, for the bar chart.
  const dailySeries = useMemo(() => {
    const byDay = {};
    periodData.forEach(item => {
      const ymd = toYMD(item.date);
      if (!ymd || ymd.length < 10) return;
      const { sk, un } = splitOf(item);
      const cur = byDay[ymd] || { sk: 0, un: 0 };
      byDay[ymd] = { sk: cur.sk + sk, un: cur.un + un };
    });
    return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  }, [periodData]);

  // ── Daily manpower: stacked skilled (primary) + unskilled (tint) ──
  useEffect(() => {
    if (!chartCanvasRef.current) return undefined;
    const primary = cssVar('--primary', '#1F4E79');
    const muted = cssVar('--muted', '#687680');
    const line = cssVar('--line', '#D6DCD9');

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(chartCanvasRef.current, {
      type: 'bar',
      data: {
        labels: dailySeries.map(([d]) => formatShortDate(d)),
        datasets: [
          { label: 'Skilled', data: dailySeries.map(([, v]) => v.sk), backgroundColor: primary, borderRadius: 2, maxBarThickness: 36, stack: 'm' },
          { label: 'Unskilled', data: dailySeries.map(([, v]) => v.un), backgroundColor: hexToRgba(primary, 0.42), borderRadius: 2, maxBarThickness: 36, stack: 'm' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: muted, font: { family: 'Barlow', size: 11 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { color: muted, font: { family: 'Barlow', size: 11 }, precision: 0 } },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [dailySeries, theme]); // re-read CSS colour tokens on theme change

  const toggle = (setter, key) => setter(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const trendTag = (pct) => {
    if (pct === null || pct === undefined) return null;
    if (pct === 0) return <span className="tag">No change</span>;
    return <span className={`tag ${pct > 0 ? 'info' : 'warn'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>;
  };
  const vsLabel = period === 'week' ? 'vs last week' : 'vs last month';
  const periodLabel = PERIODS.find(p => p[0] === period)[1].toLowerCase();

  const conditions = CONDITIONS.filter(c => conditionCounts[c.value]).map(c => [c.value, conditionCounts[c.value]]);
  const otherConditions = Object.entries(conditionCounts).filter(([k]) => !conditionClass(k));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="lede">Manpower, reporting and site conditions across all sites.</p>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" className={period === k ? 'on' : ''} aria-pressed={period === k} onClick={() => setPeriod(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid4">
        <div className="kpi accent">
          <span>Total workers</span><b>{fmt(stats.totalW)}</b>
          <small>{trends ? <>{trendTag(trends.totalW)} {vsLabel}</> : `Worker-days, ${periodLabel}`}</small>
        </div>
        <div className="kpi">
          <span>Reports filed</span><b>{fmt(stats.totalD)}</b>
          <small>{trends ? <>{trendTag(trends.totalD)} {vsLabel}</> : 'Daily reports'}</small>
        </div>
        <div className="kpi">
          <span>Average per report</span><b>{fmt(stats.avgW)}</b>
          <small>{trends ? <>{trendTag(trends.avgW)} {vsLabel}</> : 'Workers per site per day'}</small>
        </div>
        <div className="kpi">
          <span>Active sites</span><b>{stats.activeSites}</b>
          <small>{completion !== null ? `Work completion ${completion}%` : 'Sites with a report'}</small>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Daily manpower</h2>
            <div className="legend">
              <span><i style={{ background: 'var(--primary)' }} />Skilled</span>
              <span><i style={{ background: 'color-mix(in srgb, var(--primary) 42%, transparent)' }} />Unskilled</span>
            </div>
          </div>
          {dailySeries.length
            ? <div className="chart-box"><canvas ref={chartCanvasRef} role="img" aria-label="Daily manpower bar chart" /></div>
            : <p className="muted">No reports in this period.</p>}
        </section>

        <section className="panel">
          <h2 className="panel-title">Site conditions</h2>
          {conditions.length || otherConditions.length ? (
            <div className="stack" style={{ gap: 10 }}>
              {[...conditions, ...otherConditions].map(([cond, n]) => (
                <div key={cond} className="row between">
                  <span className={`badge ${conditionClass(cond)}`}><span className="cdot" />{cond}</span>
                  <span><b>{n}</b> <span className="muted small">report{n === 1 ? '' : 's'}</span></span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No conditions recorded in this period.</p>}
        </section>

        <section className="panel">
          <h2 className="panel-title">Manpower by site</h2>
          <HBars rows={sortedSites.slice(0, 8).map(([name, d]) => [name, d.total])} empty="No reports in this period." />
          <p className="small muted" style={{ marginTop: 8 }}>Total worker-days, {periodLabel}.</p>
        </section>

        <section className="panel">
          <h2 className="panel-title">Manpower by activity</h2>
          <HBars rows={activityMix} empty="No activity in this period." />
          <p className="small muted" style={{ marginTop: 8 }}>Top main activities by worker-days.</p>
        </section>

        <section className="panel wide">
          <h2 className="panel-title">Site-wise detail</h2>
          {!sortedSites.length && <p className="muted">No data for this period.</p>}
          {sortedSites.map(([mainName, mainData]) => {
            const isOpen = openSites.has(mainName);
            const direct = (mainData.subs[''] || { activities: {} }).activities;
            return (
              <div key={mainName} className="site-block">
                <button type="button" className="site-toggle" aria-expanded={isOpen} onClick={() => toggle(setOpenSites, mainName)}>
                  <span title={mainName}>{mainName}</span>
                  <span className="track"><span className="fill" style={{ width: `${Math.round(mainData.total / maxSiteTotal * 100)}%` }} /></span>
                  <b>{fmt(mainData.total)}</b>
                  <span className="chev"><Icon name="chev" /></span>
                </button>
                {isOpen && (
                  <div className="site-detail">
                    {mainData.hasSubs
                      ? Object.entries(mainData.subs).sort((a, b) => b[1].total - a[1].total).map(([subName, subData]) => {
                        const subKey = `${mainName}||${subName}`;
                        const subOpen = openSubs.has(subKey);
                        return (
                          <div key={subKey}>
                            <button type="button" className="line" aria-expanded={subOpen} onClick={() => toggle(setOpenSubs, subKey)}>
                              <span>{subName ? `↳ ${subName}` : '↳ General / direct'}</span><b>{fmt(subData.total)}</b>
                            </button>
                            {subOpen && (
                              <div className="acts-list">
                                {Object.entries(subData.activities).sort((a, b) => b[1] - a[1]).map(([act, n]) => (
                                  <div key={act} className="line"><span>{act}</span><b>{fmt(n)}</b></div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                      : Object.entries(direct).sort((a, b) => b[1] - a[1]).map(([act, n]) => (
                        <div key={act} className="line"><span>{act}</span><b>{fmt(n)}</b></div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
