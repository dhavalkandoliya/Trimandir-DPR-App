'use client';

import { ORG_NAME, formatDateTime } from '../../lib/report/reportModel';
import { TRUST, formatOutput, formatQty } from '../../lib/materials/consumption';

// The Material Consumption Report as a paper card — same design as the
// DPR (ExecutiveReport): hazard stripe, letterhead, meta grid, KPI strip,
// zebra table, Trust summary, sign-off lines. Rendered on screen and,
// off-screen at a fixed width, as the JPG export source.
export default function MaterialReport({ report }) {
  const t = report.totals;
  const by = report.loggedBy.join(', ') || '—';
  return (
    <article className="report" aria-label={`Material consumption report ${report.dprNo}`}>
      <div className="stripe" aria-hidden="true" />
      <header className="rp-head">
        <div>
          <div className="rp-org">{ORG_NAME}</div>
          <div className="rp-title">{report.title}</div>
        </div>
        <div className="rp-no">
          Report no.
          <strong>{report.dprNo}</strong>
        </div>
      </header>

      <div className="rp-body">
        <dl className="rp-meta">
          <div><dt>Date</dt><dd>{report.displayDate}</dd></div>
          <div><dt>Site</dt><dd>{report.siteDisplay}</dd></div>
          <div><dt>Logged by</dt><dd>{by}</dd></div>
          <div><dt>Materials</dt><dd>{t.materials} material{t.materials === 1 ? '' : 's'}</dd></div>
        </dl>

        <div className="rp-kpis">
          <div className="rp-kpi"><span>Consumption entries</span><b>{t.entries}</b></div>
          <div className="rp-kpi"><span>Trust</span><b>{t.trust}</b></div>
          <div className="rp-kpi"><span>Contractor / other</span><b>{t.reference}</b></div>
          <div className="rp-kpi"><span>Materials</span><b>{t.materials}</b></div>
        </div>

        <div className="rp-h">Consumption entries</div>
        {report.entries.length ? (
          <div className="rp-scroll">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="n">Qty</th>
                  <th>Unit</th>
                  <th>Ownership</th>
                  <th>Contractor</th>
                  <th>Output</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((e, i) => (
                  <tr key={i} className={`${e.ownership === TRUST ? '' : 'ref'}${i % 2 ? ' alt' : ''}`}>
                    <td><b>{e.material}</b></td>
                    <td className="n">{formatQty(e.qty)}</td>
                    <td>{e.unit}</td>
                    <td><span className={`rp-own is-${e.ownership.toLowerCase()}`}>{e.ownership}</span></td>
                    <td>{e.contractor}</td>
                    <td>{formatOutput(e.outputQty, e.outputUnit)}</td>
                    <td>{e.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rp-closed">No consumption entries for this site and date.</div>
        )}

        <div className="rp-annex">
          <div className="rp-h">Trust material total</div>
          {report.trustTotals.length ? (
            <div className="rp-scroll">
              <table className="rp-table">
                <thead><tr><th>Material</th><th className="n">Quantity</th><th className="n">Unit</th><th className="n">Entries</th></tr></thead>
                <tbody>
                  {report.trustTotals.map((tt, i) => (
                    <tr key={`${tt.material}|${tt.unit}`} className={i % 2 ? 'alt' : ''}>
                      <td>{tt.material}</td>
                      <td className="n"><b>{formatQty(tt.qty)}</b></td>
                      <td className="n">{tt.unit}</td>
                      <td className="n">{tt.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rp-closed">No Trust-supplied material in this report.</div>
          )}
          {t.reference > 0 && (
            <p className="rp-fine">
              {t.reference} Contractor/Other entr{t.reference === 1 ? 'y is' : 'ies are'} listed for reference and excluded from the Trust total.
            </p>
          )}
        </div>

        <div className="rp-foot">
          <div className="rp-sign">Logged by — {by}</div>
          <div className="rp-sign">Reviewed by — Project Manager</div>
        </div>
      </div>

      <div className="rp-gen">
        <span>Last logged: {formatDateTime(report.submittedAt) || '—'}</span>
        <span>Generated {formatDateTime(report.generatedAt)}</span>
      </div>
    </article>
  );
}
