'use client';

import { CONDITION_EMOJI, ORG_NAME, REPORT_TITLE } from '../../lib/report/reportModel';
import { TRUST, formatOutput, formatQty } from '../../lib/materials/consumption';

// Materials annex: every consumption entry for the DPR's site/day, then the
// Trust-only totals. Contractor/Other rows are shown for reference but are
// visibly marked and never counted.
function ConsumptionAnnex({ consumption }) {
  if (!consumption || !consumption.entries.length) return null;
  const { entries, trustTotals, counts } = consumption;
  const excluded = counts.Contractor + counts.Other;
  return (
    <section className="exec-annex" aria-label="Consumption entries">
      <h3 className="exec-section-title">Consumption Entries</h3>
      <div className="exec-table-wrap">
        <table className="exec-table exec-ce-table">
          <thead>
            <tr>
              <th className="c-num">#</th>
              <th>Material</th>
              <th className="c-n">Qty</th>
              <th>Unit</th>
              <th>Ownership</th>
              <th>Contractor</th>
              <th>Output / Work Done</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={e.ownership === TRUST ? '' : 'is-reference'}>
                <td className="c-num">{i + 1}</td>
                <td><b>{e.material}</b></td>
                <td className="c-n">{formatQty(e.qty)}</td>
                <td>{e.unit}</td>
                <td><span className={`exec-own is-${e.ownership.toLowerCase()}`}>{e.ownership}</span></td>
                <td>{e.contractor}</td>
                <td>{formatOutput(e.outputQty, e.outputUnit)}</td>
                <td className="c-note">{e.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="exec-subsection-title">Trust Material Total</h4>
      {trustTotals.length ? (
        <div className="exec-table-wrap">
          <table className="exec-table exec-ce-totals">
            <thead><tr><th>Material</th><th className="c-n">Total Qty</th><th>Unit</th></tr></thead>
            <tbody>
              {trustTotals.map(t => (
                <tr key={`${t.material}|${t.unit}`}>
                  <td>{t.material}</td>
                  <td className="c-n"><b>{formatQty(t.qty)}</b></td>
                  <td>{t.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="exec-empty">No Trust-supplied material in this DPR.</p>
      )}
      {excluded > 0 && (
        <p className="exec-note">
          {excluded} Contractor/Other entr{excluded === 1 ? 'y is' : 'ies are'} listed for reference and excluded from the Trust total.
        </p>
      )}
    </section>
  );
}

// Executive DPR layout — rendered on screen (Entry preview, History View
// modal) and, off-screen at a fixed width, as the source for the JPG export.
// Uses its own fixed light "paper" palette (see .exec-report in globals.css)
// so the screen, the JPG and the PDF look the same in either app theme.
export default function ExecutiveReport({ report }) {
  const t = report.totals;
  const kpis = [
    { label: 'Total Manpower', value: t.total, primary: true },
    { label: 'Skilled', value: t.skilled },
    { label: 'Unskilled', value: t.unskilled },
    { label: 'Total Activities', value: t.activities },
  ];
  let seq = 0;

  return (
    <article className="exec-report" aria-label={`DPR ${report.dprNo}`}>
      <header className="exec-head">
        <div>
          <div className="exec-org">{ORG_NAME}</div>
          <div className="exec-title">{REPORT_TITLE}</div>
        </div>
        <div className="exec-dprno">
          <span>DPR No.</span>
          <b>{report.dprNo}</b>
        </div>
      </header>

      <dl className="exec-meta">
        <div><dt>Project / Site</dt><dd>{report.siteDisplay}</dd></div>
        <div><dt>Date</dt><dd>{report.displayDate}</dd></div>
        <div>
          <dt>Prepared by</dt>
          <dd>{report.preparedBy || '—'}{report.editedBy && <span className="exec-muted"> (edited by {report.editedBy})</span>}</dd>
        </div>
        <div>
          <dt>Site condition</dt>
          <dd>
            {report.condition
              ? <span className="exec-badge">{CONDITION_EMOJI[report.condition] || ''} {report.condition}</span>
              : <span className="exec-muted">Not recorded</span>}
          </dd>
        </div>
      </dl>

      <div className="exec-kpis">
        {kpis.map(k => (
          <div key={k.label} className={`exec-kpi${k.primary ? ' is-primary' : ''}`}>
            <div className="exec-kpi-value">{k.value}</div>
            <div className="exec-kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      {report.groups.length ? (
        <div className="exec-table-wrap">
          <table className="exec-table">
            <thead>
              <tr>
                <th className="c-num">#</th>
                <th>Activity</th>
                <th className="c-n">Skilled</th>
                <th className="c-n">Unskilled</th>
                <th className="c-n">Total</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map(g => {
                if (g.collapsed) {
                  const r = g.rows[0];
                  seq += 1;
                  return (
                    <tr key={g.name} className="exec-row is-main">
                      <td className="c-num">{seq}</td>
                      <td>{g.name}</td>
                      <td className="c-n">{r.skilled}</td>
                      <td className="c-n">{r.unskilled}</td>
                      <td className="c-n"><b>{r.total}</b></td>
                      <td className="c-note">{r.note}</td>
                    </tr>
                  );
                }
                // The main-activity row carries the group's totals; its
                // sub-activities sit indented directly underneath.
                return [
                  <tr key={`${g.name}-h`} className="exec-group">
                    <td className="c-num" />
                    <td>{g.name}</td>
                    <td className="c-n">{g.totals.skilled}</td>
                    <td className="c-n">{g.totals.unskilled}</td>
                    <td className="c-n">{g.totals.total}</td>
                    <td />
                  </tr>,
                  ...g.rows.map((r, i) => {
                    seq += 1;
                    return (
                      <tr key={`${g.name}-${i}`} className="exec-row">
                        <td className="c-num">{seq}</td>
                        <td className={r.isSub ? 'c-sub' : ''}>{r.name}</td>
                        <td className="c-n">{r.skilled}</td>
                        <td className="c-n">{r.unskilled}</td>
                        <td className="c-n">{r.total}</td>
                        <td className="c-note">{r.note}</td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
            <tfoot>
              <tr className="exec-grand">
                <td />
                <td>Grand Total</td>
                <td className="c-n">{t.skilled}</td>
                <td className="c-n">{t.unskilled}</td>
                <td className="c-n">{t.total}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="exec-empty">No manpower recorded for this DPR.</p>
      )}

      <ConsumptionAnnex consumption={report.consumption} />

      <footer className="exec-foot">
        <span>{report.dprNo}</span>
        <span>Generated {new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </footer>
    </article>
  );
}
