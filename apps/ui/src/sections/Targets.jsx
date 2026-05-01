import Card from '../components/Card';
import Field from '../components/Field';
import SegChoice from '../components/SegChoice';

const alertIcon = <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;

const PRESETS = {
  standard: { urgent_low: 55, low: 70, high: 180, urgent_high: 250 },
  tighter: { urgent_low: 60, low: 75, high: 160, urgent_high: 220 },
  wider: { urgent_low: 55, low: 70, high: 200, urgent_high: 260 },
};

export default function TargetsSection({ form, onChange }) {
  const units = form.bg_units || 'mg/dL';

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.entries(p).forEach(([k, v]) => onChange(k, v));
  }

  return (
    <Card iconClass="ic-alert" icon={alertIcon} title="Glucose targets" sub="Ranges used for alerts and display colors">
      <Field label="Glucose units" desc="Units used in the dashboard and on device.">
        <SegChoice options={[['mg/dL','mg/dL'],['mmol/L','mmol/L']]} value={units} onChange={v => onChange('bg_units', v)} />
      </Field>
      <Field label="Target presets" desc="Apply a quick profile, then fine-tune below.">
        <div className="choice-group">
          {['standard','tighter','wider'].map(p => (
            <button key={p} type="button" className="choice-pill" onClick={() => applyPreset(p)}>
              {p.charAt(0).toUpperCase()+p.slice(1)}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Urgent low" desc="Highest-priority visual alert.">
        <div className="thr-row">
          <input className="inp inp-xs" type="number" value={form.urgent_low || 55} onChange={e => onChange('urgent_low', Number(e.target.value))} />
          <span className="thr-unit">{units}</span>
        </div>
      </Field>
      <Field label="Low threshold">
        <div className="thr-row">
          <input className="inp inp-xs" type="number" value={form.low || 70} onChange={e => onChange('low', Number(e.target.value))} />
          <span className="thr-unit">{units}</span>
        </div>
      </Field>
      <Field label="High threshold">
        <div className="thr-row">
          <input className="inp inp-xs" type="number" value={form.high || 180} onChange={e => onChange('high', Number(e.target.value))} />
          <span className="thr-unit">{units}</span>
        </div>
      </Field>
      <Field label="Urgent high">
        <div className="thr-row">
          <input className="inp inp-xs" type="number" value={form.urgent_high || 250} onChange={e => onChange('urgent_high', Number(e.target.value))} />
          <span className="thr-unit">{units}</span>
        </div>
      </Field>
      <Field label="Alert appearance" desc="Visual style for threshold alerts on device.">
        <div className="radio-group">
          {['pulse','flash','color only'].map(s => (
            <label key={s} className="radio-opt">
              <input type="radio" name="bg_alert_style" value={s} checked={(form.bg_alert_style || 'pulse') === s} onChange={() => onChange('bg_alert_style', s)} />
              {s.charAt(0).toUpperCase()+s.slice(1)}
            </label>
          ))}
        </div>
      </Field>
    </Card>
  );
}
