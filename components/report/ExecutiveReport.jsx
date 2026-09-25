'use client';

import { ORG_NAME, REPORT_TITLE, conditionClass, formatDateTime } from '../../lib/report/reportModel';
import { TRUST, formatOutput, formatQty } from '../../lib/materials/consumption';

export function ConditionBadge({ condition }) {
  if (!condition) return <span className="muted small">Not recorded</span>;
  return <span className={`badge ${conditionClass(condition)}`}><span className="cdot" />{condition}</span>;
}

// Annex: every consumption entry for the DPR's site/day, then the
// Trust-only totals. Contractor/Other rows are shown for reference but are
// visibly marked and never counted.
function ConsumptionAnnex({ consumption }) {
  if (!consumption || !consumption.entries.length) return null;
  const { entries, trustTotals, counts } = consumption;
  const excluded = counts.Contractor + counts.Other;
  return (
    <section className="rp-annex" aria-label="Material consumption">
      <div className="rp-h">Annex: material consumption</div>
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
            {entries.map((e, i) => (
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

      <div className="rp-h">Trust material total</div>
      {trustTotals.length ? (
        <div className="rp-scroll">
          <table className="rp-table">
            <thead><tr><th>Material</th><th className="n">Quantity</th><th className="n">Unit</th></tr></thead>
            <tbody>
              {trustTotals.map((t, i) => (
                <tr key={`${t.material}|${t.unit}`} className={i % 2 ? 'alt' : ''}>
                  <td>{t.material}</td>
                  <td className="n"><b>{formatQty(t.qty)}</b></td>
                  <td className="n">{t.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rp-closed">No Trust-supplied material in this report.</div>
      )}
      {excluded > 0 && (
        <p className="rp-fine">
          {excluded} Contractor/Other entr{excluded === 1 ? 'y is' : 'ies are'} listed for reference and excluded from the Trust total.
        </p>
      )}
    </section>
  );
}

// The DPR as an A4-style paper card — rendered on screen (Entry live
// preview, success view, History viewer) and, off-screen at a fixed width,
// as the source for the JPG export. Its palette is fixed (.report in
// globals.css), so screen, JPG and PDF look the same in either app theme.
export default function ExecutiveReport({ report }) {
  const t = report.totals;
  const notes = [];
  report.groups.forEach(g => g.rows.forEach(r => {
    if (r.note) notes.push({ activity: r.isSub ? `${g.name} / ${r.name}` : g.name, text: r.note });
  }));

  // Main-activity rows carry their group's totals, with sub-activities
  // indented underneath; plain rows alternate for a zebra read.
  let zebra = 0;
  const bodyRows = [];
  report.groups.forEach(g => {
    if (g.collapsed) {
      const r = g.rows[0];
      bodyRows.push(
        <tr key={g.name} className="grp">
          <td>{g.name}</td><td className="n">{r.skilled}</td><td className="n">{r.unskilled}</td><td className="n">{r.total}</td>
        </tr>
      );
      return;
    }
    zebra = 0;
    bodyRows.push(
      <tr key={`${g.name}-h`} className="grp">
        <td>{g.name}</td><td className="n">{g.totals.skilled}</td><td className="n">{g.totals.unskilled}</td><td className="n">{g.totals.total}</td>
      </tr>
    );
    g.rows.forEach((r, i) => {
      bodyRows.push(
        <tr key={`${g.name}-${i}`} className={`${r.isSub ? 'sub' : ''}${zebra++ % 2 ? ' alt' : ''}`}>
          <td>{r.name}</td><td className="n">{r.skilled}</td><td className="n">{r.unskilled}</td><td className="n">{r.total}</td>
        </tr>
      );
    });
  });

  const submitted = report.draft ? 'Not submitted yet' : (formatDateTime(report.submittedAt) || '—');

  return (
    <article className="report" aria-label={`DPR ${report.dprNo}`}>
      <div className="stripe" aria-hidden="true" />
      <header className="rp-head">
        <div>
          <div className="rp-org">{ORG_NAME}</div>
          <div className="rp-title">{REPORT_TITLE}</div>
        </div>
        <div className="rp-no">
          Report no.
          <strong>{report.dprNo}</strong>
          {report.draft ? 'Draft preview' : ''}
        </div>
      </header>

      <div className="rp-body">
        <dl className="rp-meta">
          <div><dt>Date</dt><dd>{report.displayDate}</dd></div>
          <div><dt>Site</dt><dd>{report.siteDisplay}</dd></div>
          <div>
            <dt>Prepared by</dt>
            <dd>{report.preparedBy || '—'}{report.editedBy && <small> (edited by {report.editedBy})</small>}</dd>
          </div>
          <div><dt>Site condition</dt><dd><ConditionBadge condition={report.condition} /></dd></div>
        </dl>

        <div className="rp-kpis">
          <div className="rp-kpi"><span>Total manpower</span><b>{t.total}</b></div>
          <div className="rp-kpi"><span>Skilled</span><b>{t.skilled}</b></div>
          <div className="rp-kpi"><span>Unskilled</span><b>{t.unskilled}</b></div>
          <div className="rp-kpi"><span>Activities</span><b>{t.activities}</b></div>
        </div>

        <div className="rp-h">Manpower deployment</div>
        {report.groups.length ? (
          <table className="rp-table">
            <thead><tr><th>Activity</th><th className="n">Skilled</th><th className="n">Unskilled</th><th className="n">Total</th></tr></thead>
            <tbody>{bodyRows}</tbody>
            <tfoot><tr><td>Total manpower</td><td className="n">{t.skilled}</td><td className="n">{t.unskilled}</td><td className="n">{t.total}</td></tr></tfoot>
          </table>
        ) : (
          <div className="rp-closed">
            {report.condition === 'Site Closed' || report.condition === 'Holiday'
              ? `No manpower deployed — ${report.condition.toLowerCase()}.`
              : 'Add at least one activity with workers to build the manpower table.'}
          </div>
        )}

        {notes.length > 0 && (
          <div className="rp-notes">
            <div className="rp-h">Site notes</div>
            <ul>{notes.map((n, i) => <li key={i}><b>{n.activity}:</b> {n.text}</li>)}</ul>
          </div>
        )}

        <ConsumptionAnnex consumption={report.consumption} />

        <div className="rp-foot">
          <div className="rp-sign">Prepared by — {report.preparedBy || '—'}</div>
          <div className="rp-sign">Reviewed by — Project Manager</div>
        </div>
      </div>

      <div className="rp-gen">
        <span>Submitted: {submitted}</span>
        <span>Generated {formatDateTime(report.generatedAt)}</span>
      </div>
    </article>
  );
}
