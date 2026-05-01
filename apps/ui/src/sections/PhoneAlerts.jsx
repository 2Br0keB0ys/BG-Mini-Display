import Card from '../components/Card';
import Field, { Tip } from '../components/Field';
import Toggle from '../components/Toggle';
import { Badge } from '../components/Badge';

const pushIcon = <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;

export default function PhoneAlertsSection({ form, onChange, meta }) {
  const configured = !!meta.pushoverConfigured;
  return (
    <Card iconClass="ic-push" icon={pushIcon} title="Phone alerts" sub="Urgent alerts via Pushover">
      <Tip><b>Pushover keys:</b> Paste User Key and App Token from pushover.net. Leave blank to keep stored credentials.</Tip>
      <Field label="Enable phone alerts" desc="Send urgent low/high alerts to your phone.">
        <Toggle checked={!!form.pushover_enabled} onChange={v => onChange('pushover_enabled', v)} />
      </Field>
      <Field label="Pushover user key" desc={configured ? 'Stored. Enter a new value only to replace it.' : 'Your personal user key from pushover.net.'}>
        <input className="inp" type="password" value={form.pushover_user_key || ''} placeholder={configured ? '(stored)' : 'user key'} onChange={e => onChange('pushover_user_key', e.target.value)} />
      </Field>
      <Field label="Pushover app token" desc={configured ? 'Stored. Enter a new value only to replace it.' : 'App API token from pushover.net.'}>
        <input className="inp" type="password" value={form.pushover_api_token || ''} placeholder={configured ? '(stored)' : 'api token'} onChange={e => onChange('pushover_api_token', e.target.value)} />
      </Field>
      <Field label="Alert cooldown" desc="Minimum time between repeated urgent alerts.">
        <select className="inp" value={form.pushover_alert_cooldown_min || 15} onChange={e => onChange('pushover_alert_cooldown_min', Number(e.target.value))}>
          {[[5,'5 min'],[10,'10 min'],[15,'15 min'],[30,'30 min'],[60,'60 min']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <Badge text={configured ? 'Credentials stored' : 'Not configured'} variant={configured ? 'green' : 'amber'} />
      </Field>
    </Card>
  );
}
