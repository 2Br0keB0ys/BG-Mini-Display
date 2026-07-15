import { useEffect, useMemo, useState } from 'react';
import ConnectionPanel from './components/ConnectionPanel.jsx';
import FilterBar from './components/FilterBar.jsx';
import LogTable from './components/LogTable.jsx';
import ExportButton from './components/ExportButton.jsx';
import { rowsFromLatest, rowsFromHistory } from './lib/parseLogs.js';
import { WORKER_URL as DEFAULT_WORKER_URL, LOG_LEVELS } from './constants.js';

const hasApi = typeof window !== 'undefined' && !!window.api;

export default function App() {
  const [workerUrl, setWorkerUrl] = useState(DEFAULT_WORKER_URL);
  const [adminDevKey, setAdminDevKey] = useState('');
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('Not connected');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLevels, setSelectedLevels] = useState(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState(new Set());

  useEffect(() => {
    if (!hasApi) return;
    window.api.getConfig().then((cfg) => {
      if (cfg?.workerUrl) setWorkerUrl(cfg.workerUrl);
      if (cfg?.adminDevKey) setAdminDevKey(cfg.adminDevKey);
    });
  }, []);

  const features = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.feat).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.msg.toLowerCase().includes(q)) return false;
      if (selectedLevels.size && !selectedLevels.has(row.lvl)) return false;
      if (selectedFeatures.size && !selectedFeatures.has(row.feat)) return false;
      return true;
    });
  }, [rows, search, selectedLevels, selectedFeatures]);

  if (!hasApi) {
    return (
      <div className="app">
        <h1>BGDisplay Log Viewer</h1>
        <div className="empty-state">
          This app must run inside the Electron shell (<code>npm run dev</code> or the packaged app)
          &mdash; opening the Vite dev server directly in a browser tab has no access to the preload
          bridge that talks to the Worker.
        </div>
      </div>
    );
  }

  const saveWorkerUrl = () => {
    window.api.setConfig({ workerUrl, adminDevKey });
  };

  const pullLatest = async () => {
    setLoading(true);
    setStatus('Pulling latest upload...');
    try {
      const res = await window.api.fetchLatest({ limit: 400 });
      setRows(rowsFromLatest(res));
      setStatus(`Loaded ${res.total} lines from latest upload`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const pullHistory = async () => {
    setLoading(true);
    setStatus('Pulling upload history...');
    try {
      const res = await window.api.fetchAll({ limit: 60 });
      setRows(rowsFromHistory(res));
      setStatus(`Loaded ${res.included} of ${res.totalAvailable} historical uploads`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleLevel = (lvl) => {
    setSelectedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const toggleFeature = (feat) => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(feat)) next.delete(feat);
      else next.add(feat);
      return next;
    });
  };

  return (
    <div className="app">
      <h1>BGDisplay Log Viewer</h1>
      <ConnectionPanel
        workerUrl={workerUrl}
        onWorkerUrlChange={setWorkerUrl}
        adminDevKey={adminDevKey}
        onAdminDevKeyChange={setAdminDevKey}
        onSave={saveWorkerUrl}
        onPullLatest={pullLatest}
        onPullHistory={pullHistory}
        status={status}
        loading={loading}
      />
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        levels={LOG_LEVELS}
        selectedLevels={selectedLevels}
        onToggleLevel={toggleLevel}
        features={features}
        selectedFeatures={selectedFeatures}
        onToggleFeature={toggleFeature}
      />
      <div className="toolbar">
        <span>
          {filteredRows.length} of {rows.length} rows
        </span>
        <ExportButton rows={filteredRows} />
      </div>
      <LogTable rows={filteredRows} />
    </div>
  );
}
