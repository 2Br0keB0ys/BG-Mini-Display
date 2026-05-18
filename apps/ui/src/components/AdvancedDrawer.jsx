import { useEffect } from 'react';
import { DeviceActions, AlertTuning } from '../sections/adv/Operations';
import { Diagnostics, CloudInsights } from '../sections/adv/Diagnostics';
import SecuritySection from '../sections/adv/Security';
import { BackupSection, MaintenanceSection } from '../sections/adv/DataAdmin';
import { DeviceRegistrySection } from '../sections/adv/DeviceRegistry';

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
      </aside>
    </>
  );
}
