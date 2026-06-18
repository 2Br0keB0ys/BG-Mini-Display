import { useEffect, useState, lazy, Suspense } from 'react';

// Advanced-tools sections are rarely opened, so their code is split into a
// separate chunk and only fetched once the drawer is actually opened for the
// first time (see hasOpened below), rather than shipping with the main bundle.
const DeviceActions = lazy(() =>
  import('../sections/adv/Operations').then((m) => ({ default: m.DeviceActions }))
);
const AlertTuning = lazy(() =>
  import('../sections/adv/Operations').then((m) => ({ default: m.AlertTuning }))
);
const Diagnostics = lazy(() =>
  import('../sections/adv/Diagnostics').then((m) => ({ default: m.Diagnostics }))
);
const CloudInsights = lazy(() =>
  import('../sections/adv/Diagnostics').then((m) => ({ default: m.CloudInsights }))
);
const SecuritySection = lazy(() => import('../sections/adv/Security'));
const BackupSection = lazy(() =>
  import('../sections/adv/DataAdmin').then((m) => ({ default: m.BackupSection }))
);
const MaintenanceSection = lazy(() =>
  import('../sections/adv/DataAdmin').then((m) => ({ default: m.MaintenanceSection }))
);
const DeviceRegistrySection = lazy(() =>
  import('../sections/adv/DeviceRegistry').then((m) => ({ default: m.DeviceRegistrySection }))
);

export default function AdvancedDrawer({
  open,
  onClose,
  form,
  onChange,
  onSave,
  saving,
  meta,
  metrics,
  maint,
  showToast,
  onCommand,
  onConfigReload,
}) {
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div className={`overlay${open ? ' show' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' show' : ''}`}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">Advanced tools</div>
            <div className="drawer-sub">
              Technical controls kept here so daily setup stays simple.
            </div>
          </div>
          <div className="drawer-actions">
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {hasOpened && (
          <Suspense fallback={<div className="drawer-grid">Loading…</div>}>
            <div className="drawer-grid">
              <DeviceActions meta={meta} onCommand={onCommand} showToast={showToast} />
              <AlertTuning form={form} onChange={onChange} />
              <Diagnostics meta={meta} showToast={showToast} />
              <CloudInsights metrics={metrics} />
              <SecuritySection
                form={form}
                onChange={onChange}
                meta={meta}
                showToast={showToast}
                onConfigReload={onConfigReload}
              />
              <DeviceRegistrySection showToast={showToast} />
              <BackupSection form={form} onChange={onChange} showToast={showToast} />
              <MaintenanceSection meta={meta} maint={maint} />
            </div>
          </Suspense>
        )}
      </aside>
    </>
  );
}
