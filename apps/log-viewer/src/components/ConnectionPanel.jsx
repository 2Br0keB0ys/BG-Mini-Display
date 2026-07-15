export default function ConnectionPanel({
  workerUrl,
  onWorkerUrlChange,
  adminDevKey,
  onAdminDevKeyChange,
  onSave,
  onPullLatest,
  onPullHistory,
  status,
  loading,
}) {
  return (
    <div className="panel connection-panel">
      <label htmlFor="worker-url">Worker URL</label>
      <input
        id="worker-url"
        type="text"
        value={workerUrl}
        onChange={(e) => onWorkerUrlChange(e.target.value)}
        onBlur={onSave}
      />
      <label htmlFor="admin-dev-key">Admin dev key</label>
      <input
        id="admin-dev-key"
        type="password"
        placeholder="ADMIN_DEV_KEY"
        value={adminDevKey}
        onChange={(e) => onAdminDevKeyChange(e.target.value)}
        onBlur={onSave}
      />
      <div className="actions">
        <button onClick={onPullLatest} disabled={loading}>
          Pull latest
        </button>
        <button onClick={onPullHistory} disabled={loading}>
          Pull history
        </button>
      </div>
      <span className="status">{status}</span>
    </div>
  );
}
