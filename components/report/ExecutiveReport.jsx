'use client';

import { CONDITION_EMOJI, ORG_NAME, REPORT_TITLE } from '../../lib/report/reportModel';

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
                return [
                  <tr key={`${g.name}-h`} className="exec-group"><td colSpan={6}>{g.name}</td></tr>,
                  ...g.rows.map((r, i) => {
                    seq += 1;
                    return (
                      <tr key={`${g.name}-${i}`} className="exec-row">
                        <td className="c-num">{seq}</td>
                        <td className={r.isSub ? 'c-sub' : ''}>{r.name}</td>
                        <td className="c-n">{r.skilled}</td>
                        <td className="c-n">{r.unskilled}</td>
                        <td className="c-n"><b>{r.total}</b></td>
                        <td className="c-note">{r.note}</td>
                      </tr>
                    );
                  }),
                  <tr key={`${g.name}-s`} className="exec-subtotal">
                    <td />
                    <td>Subtotal — {g.name}</td>
                    <td className="c-n">{g.subtotal.skilled}</td>
                    <td className="c-n">{g.subtotal.unskilled}</td>
                    <td className="c-n">{g.subtotal.total}</td>
                    <td />
                  </tr>,
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

      <footer className="exec-foot">
        <span>{report.dprNo}</span>
        <span>Generated {new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </footer>
    </article>
  );
}
