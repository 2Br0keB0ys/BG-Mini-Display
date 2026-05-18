import Card from '../components/Card';
import Field, { Tip } from '../components/Field';
import Toggle from '../components/Toggle';
import SegChoice from '../components/SegChoice';
import { DAYS, DAY_LABELS } from '../helpers';
import { apiGet } from '../api';

const displayIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export default function DisplaySection({ form, onChange, showToast }) {
  async function detectTz() {
    try {
      const d = await apiGet('/api/detect-timezone');
      if (d.detected) {
        onChange('timezone', d.detected);
        showToast(`✓ Detected: ${d.detected}`);
      } else showToast('❌ Could not detect timezone');
    } catch {
      showToast('❌ Timezone detection failed');
    }
  }

  return (
    <Card
      iconClass="ic-display"
      icon={displayIcon}
      title="Screen & quiet hours"
      sub="Clock style, brightness, DND schedule"
    >
      <Field label="Trend arrow" desc="Show glucose direction next to the reading.">
        <Toggle
          checked={form.show_trend_arrow !== false}
          onChange={(v) => onChange('show_trend_arrow', v)}
        />
      </Field>
      <Field label="Reading age" desc='Show "X min ago" under the glucose value.'>
        <Toggle
          checked={form.show_last_reading_time !== false}
          onChange={(v) => onChange('show_last_reading_time', v)}
        />
      </Field>
      <Field label="Clock format">
        <SegChoice
          options={[
            [false, '12-hour'],
            [true, '24-hour'],
          ]}
          value={String(!!form.clock_24hr)}
          onChange={(v) => onChange('clock_24hr', v === 'true')}
        />
      </Field>
      <Field label="Timezone">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="inp"
            value={form.timezone || 'US/Central'}
            onChange={(e) => onChange('timezone', e.target.value)}
          >
            {[
              ['US/Central', 'US / Central'],
              ['US/Eastern', 'US / Eastern'],
              ['US/Mountain', 'US / Mountain'],
              ['US/Pacific', 'US / Pacific'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn" onClick={detectTz}>
            Auto-detect
          </button>
        </div>
      </Field>
      <Field label="Screen brightness" desc="Dims to 15% after 5 min idle until touched.">
        <SegChoice
          options={[
            [25, '25%'],
            [50, '50%'],
            [75, '75%'],
            [100, '100%'],
          ]}
          value={form.brightness || 100}
          onChange={(v) => onChange('brightness', Number(v))}
        />
      </Field>
      <Field label="Do Not Disturb" desc="Turn the screen off during quiet hours.">
        <Toggle checked={!!form.dnd_enabled} onChange={(v) => onChange('dnd_enabled', v)} />
      </Field>
      <Tip>
        <b>DND format:</b> Use 12-hour time like "10:30 PM". Schedule is per-day.
      </Tip>
      {DAYS.map((day) => (
        <Field key={day} label={DAY_LABELS[day]} sub>
          <div className="time-pair">
            <input
              className="inp"
              style={{ width: 86 }}
              type="text"
              value={form[`dnd_${day}_from`] || ''}
              placeholder="11:00 PM"
              onChange={(e) => onChange(`dnd_${day}_from`, e.target.value)}
            />
            <span>to</span>
            <input
              className="inp"
              style={{ width: 86 }}
              type="text"
              value={form[`dnd_${day}_to`] || ''}
              placeholder="6:00 AM"
              onChange={(e) => onChange(`dnd_${day}_to`, e.target.value)}
            />
          </div>
        </Field>
      ))}
    </Card>
  );
}
