import Card from '../components/Card';
import Field from '../components/Field';
import { PUMP_CATALOG } from '../constants';

const pumpIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
  </svg>
);

export default function PumpSection({ form, onChange }) {
  const brandEntry =
    PUMP_CATALOG.find((b) => b.brand === (form.insulin_pump_brand || 'No pump')) || PUMP_CATALOG[0];
  const modelEntry =
    brandEntry.models.find((m) => m.model === form.insulin_pump_model) || brandEntry.models[0];
  const currentMode = modelEntry.modes.includes(form.insulin_pump_loop_mode)
    ? form.insulin_pump_loop_mode
    : modelEntry.modes[0];

  function onBrandChange(brand) {
    const b = PUMP_CATALOG.find((x) => x.brand === brand) || PUMP_CATALOG[0];
    const m = b.models[0];
    onChange('insulin_pump_brand', b.brand);
    onChange('insulin_pump_model', m.model);
    onChange('insulin_pump_type', m.type);
    onChange('insulin_pump_loop_mode', m.modes[0]);
  }

  function onModelChange(model) {
    const m = brandEntry.models.find((x) => x.model === model) || brandEntry.models[0];
    onChange('insulin_pump_model', m.model);
    onChange('insulin_pump_type', m.type);
    onChange('insulin_pump_loop_mode', m.modes[0]);
  }

  return (
    <Card
      iconClass="ic-pump"
      icon={pumpIcon}
      title="Insulin profile"
      sub="Optional context for AI summaries"
    >
      <Field label="Pump brand">
        <select
          className="inp"
          value={brandEntry.brand}
          onChange={(e) => onBrandChange(e.target.value)}
        >
          {PUMP_CATALOG.map((b) => (
            <option key={b.brand} value={b.brand}>
              {b.brand}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pump model" desc="Filtered by selected brand.">
        <select
          className="inp"
          value={modelEntry.model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {brandEntry.models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Automation mode">
        <select
          className="inp"
          value={currentMode}
          onChange={(e) => onChange('insulin_pump_loop_mode', e.target.value)}
        >
          {modelEntry.modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Additional notes"
        desc="Optional context for AI (e.g., exercise patterns, overnight trends)."
      >
        <input
          className="inp"
          type="text"
          value={form.insulin_pump_notes || ''}
          placeholder="Optional"
          onChange={(e) => onChange('insulin_pump_notes', e.target.value)}
        />
      </Field>
    </Card>
  );
}
