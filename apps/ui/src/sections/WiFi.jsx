import Card from '../components/Card';
import Field, { Tip } from '../components/Field';
import Toggle from '../components/Toggle';

const wifiIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <path d="M5 12.55a11 11 0 0114.08 0" />
    <path d="M1.42 9a16 16 0 0121.16 0" />
    <path d="M8.53 16.11a6 6 0 016.95 0" />
    <circle cx="12" cy="20" r="1" fill="currentColor" />
  </svg>
);

export default function WiFiSection({ form, onChange }) {
  const wifiOpen = !!form.wifi_open;
  return (
    <Card
      iconClass="ic-wifi"
      icon={wifiIcon}
      title="Connect to Wi-Fi"
      sub="Network SSID and password"
    >
      <Tip>
        <b>First-time setup:</b> Save Wi-Fi first. If SSID or password changes the device reboots to
        reconnect.
      </Tip>
      <Field label="Wi-Fi network (SSID)" desc={`Current: ${form.wifi_ssid || 'Not set yet'}`}>
        <input
          className="inp"
          type="text"
          value={form.wifi_ssid || ''}
          placeholder="HomeWiFi"
          onChange={(e) => onChange('wifi_ssid', e.target.value)}
        />
      </Field>
      <Field label="Wi-Fi password" desc="Leave blank to keep existing password.">
        <input
          className="inp"
          type="password"
          value={form.wifi_pass || ''}
          placeholder={wifiOpen ? 'Open network' : 'New password'}
          disabled={wifiOpen}
          onChange={(e) => onChange('wifi_pass', e.target.value)}
        />
      </Field>
      <Field label="Open network" desc="Only for networks with no password.">
        <Toggle checked={wifiOpen} onChange={(v) => onChange('wifi_open', v)} />
      </Field>
      <Field
        label="Cellular LTE fallback"
        desc={
          <span>
            M5Stack SIM7600G module required.{' '}
            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Coming soon.</span>
          </span>
        }
      >
        <span className="row-meta">Not available</span>
      </Field>
    </Card>
  );
}
