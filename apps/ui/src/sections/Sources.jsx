import Card from '../components/Card';
import Field, { Tip } from '../components/Field';
import SegChoice from '../components/SegChoice';

const dexIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
  </svg>
);

export default function SourcesSection({ form, onChange }) {
  return (
    <Card
      iconClass="ic-dex"
      icon={dexIcon}
      title="Glucose sources"
      sub="Dexcom primary · Nightscout fallback"
    >
      <Tip>
        <b>Common issue:</b> Dexcom login fails if region is wrong. Use the same username format as
        the Dexcom Share app.
      </Tip>
      <Field label="Nightscout URL">
        <input
          className="inp"
          type="url"
          value={form.nightscout_url || ''}
          placeholder="https://yoursite.ns.io"
          onChange={(e) => onChange('nightscout_url', e.target.value)}
        />
      </Field>
      <Field label="Nightscout token / secret" desc="Used to read data from your Nightscout site.">
        <input
          className="inp"
          type="password"
          value={form.nightscout_secret || ''}
          placeholder="token or secret"
          onChange={(e) => onChange('nightscout_secret', e.target.value)}
        />
      </Field>
      <Field label="Dexcom username">
        <input
          className="inp"
          type="text"
          value={form.dexcom_user || ''}
          placeholder="email or +1xxxxxxxxxx"
          onChange={(e) => onChange('dexcom_user', e.target.value)}
        />
      </Field>
      <Field label="Dexcom password" desc="Leave blank to keep existing password.">
        <input
          className="inp"
          type="password"
          value={form.dexcom_pass || ''}
          placeholder="••••••••"
          onChange={(e) => onChange('dexcom_pass', e.target.value)}
        />
      </Field>
      <Field label="Dexcom region" desc="Match your Dexcom account region.">
        <SegChoice
          options={[
            ['US', 'US'],
            ['Non-US', 'Non-US'],
          ]}
          value={form.dexcom_region || 'US'}
          onChange={(v) => onChange('dexcom_region', v)}
        />
      </Field>
      <Field label="Reading refresh interval" desc="How often the device checks for new readings.">
        <SegChoice
          options={[
            [1, '1 min'],
            [5, '5 min'],
            [10, '10 min'],
          ]}
          value={form.poll_interval_min || 1}
          onChange={(v) => onChange('poll_interval_min', Number(v))}
        />
      </Field>
      <Field label="Stale reading warning" desc="Show stale status after no new reading.">
        <SegChoice
          options={[
            [5, '5m'],
            [10, '10m'],
            [15, '15m'],
            [20, '20m'],
          ]}
          value={form.stale_data_warn_min || 10}
          onChange={(v) => onChange('stale_data_warn_min', Number(v))}
        />
      </Field>
      <Field label="Config sync interval" desc="How often the device checks for setting updates.">
        <SegChoice
          options={[
            [1, '1m'],
            [2, '2m'],
            [5, '5m'],
          ]}
          value={form.config_ping_min || 1}
          onChange={(v) => onChange('config_ping_min', Number(v))}
        />
      </Field>
    </Card>
  );
}
