import { useState } from 'react';
import Card from '../../components/Card';
import { Badge } from '../../components/Badge';
import { fmtTs } from '../../helpers';
import { apiGet } from '../../api';

const diagIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export function Diagnostics({ meta, showToast }) {
  const [res, setRes] = useState({ worker: null, dex: null, latency: null });
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setRes({ worker: 'testing', dex: null, latency: null });
    const t0 = Date.now();
    try {
      await apiGet('/api/admin/config');
      setRes({
        worker: 'ok',
        dex: meta.config?.dexcom_user ? 'configured' : 'not configured',
        latency: Date.now() - t0,
      });
    } catch {
      setRes({ worker: 'error', dex: null, latency: null });
    }
    setRunning(false);
  }

  return (
    <Card
      iconClass="ic-diag"
      icon={diagIcon}
      title="Diagnostics"
      sub="Connectivity and service checks"
    >
      <div className="diag-row">
        <span>Cloudflare Worker</span>
        <span>
          {res.worker ? (
            <Badge
              text={res.worker === 'ok' ? 'OK' : res.worker === 'testing' ? 'Testing…' : 'Error'}
              variant={res.worker === 'ok' ? 'green' : res.worker === 'testing' ? 'blue' : 'red'}
            />
          ) : (
            <Badge text="—" variant="blue" />
          )}
        </span>
      </div>
      <div className="diag-row">
        <span>Dexcom Share</span>
        <span>
          {res.dex ? (
            <Badge
              text={res.dex === 'configured' ? 'Configured' : 'Not configured'}
              variant={res.dex === 'configured' ? 'green' : 'amber'}
            />
          ) : (
            <Badge text="—" variant="blue" />
          )}
        </span>
      </div>
      <div className="diag-row">
        <span>Worker latency</span>
        <span className="row-meta">{res.latency != null ? `${res.latency}ms` : '—'}</span>
      </div>
      <div className="diag-row">
        <span>Last seen</span>
        <span className="row-meta">{fmtTs(meta.status?.lastSeen)}</span>
      </div>
      <div className="diag-row">
        <span>Firmware version</span>
        <span className="row-meta">{meta.status?.firmware || '—'}</span>
      </div>
      <div style={{ padding: '10px 13px' }}>
        <button className="btn btn-full" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run connectivity check'}
        </button>
      </div>
    </Card>
  );
}

export function CloudInsights({ metrics }) {
  const mx = metrics?.metrics || {};
  return (
    <Card
      iconClass="ic-diag"
      icon={diagIcon}
      title="Cloud insights"
      sub="Telemetry trends and worker metrics"
    >
      {[
        ['Telemetry samples', mx.samples ?? '—'],
        ['Average RSSI', mx.avgRssi != null ? `${mx.avgRssi} dBm` : '—'],
        ['Battery range', mx.minBattery != null ? `${mx.minBattery}% / ${mx.maxBattery}%` : '—'],
        ['Stale reading ratio', mx.staleSamplePct != null ? `${mx.staleSamplePct}%` : '—'],
        [
          'Events (1h)',
          `${mx.eventCounts1h?.alert ?? 0} alerts / ${mx.eventCounts1h?.configSave ?? 0} saves`,
        ],
        [
          'Source health',
          `NS ${mx.sourceHealth?.nsOk ?? 0}/${mx.sourceHealth?.nsFail ?? 0} · Dex ${mx.sourceHealth?.dexOk ?? 0}/${mx.sourceHealth?.dexFail ?? 0}`,
        ],
        ['Confidence score', mx.confidence?.score != null ? `${mx.confidence.score}%` : '—'],
      ].map(([k, v]) => (
        <div key={k} className="vrow">
          <span className="vrow-label">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </Card>
  );
}
