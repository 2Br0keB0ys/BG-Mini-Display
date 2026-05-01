import { useState } from 'react';
import Card from '../components/Card';
import Field from '../components/Field';
import Toggle from '../components/Toggle';
import { fmtTs } from '../helpers';
import { apiPost } from '../api';

const aiIcon = <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>;

export default function DigestSection({ form, onChange, meta, showToast }) {
  const [genBusy, setGenBusy] = useState(false);
  const digest = meta.digest;
  const model = form.ai_model || digest?.ai_model || '@cf/meta/llama-3.1-8b-instruct';

  const digestHours = Array.from({ length: 24 }, (_, i) => {
    const ap = i < 12 ? 'AM' : 'PM', h = i === 0 ? 12 : (i > 12 ? i - 12 : i);
    return [i, `${h}:00 ${ap} US/Central`];
  });

  async function generate() {
    setGenBusy(true);
    try {
      await apiPost('/api/admin/digest/generate', {});
      showToast('✓ Digest generated');
    } catch { showToast('❌ Digest generation failed'); }
    finally { setGenBusy(false); }
  }

  return (
    <Card iconClass="ic-ai" icon={aiIcon} title="AI daily summary" sub="Glucose summary via Workers AI">
      <Field label="Today's summary" desc={digest?.generatedAt ? `Generated ${fmtTs(digest.generatedAt)}` : 'Generated daily at 7 AM US/Central'}>
        {digest?.text
          ? <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--fg)', maxWidth: 300, whiteSpace: 'pre-wrap' }}>{digest.text}</div>
          : <span className="row-meta">No summary yet. Runs daily at 7 AM, hourly 8 AM–11 PM US/Central.</span>}
      </Field>
      <Field label="Generate on demand" desc="Force-regenerate from the last 24h of readings.">
        <button className="btn" onClick={generate} disabled={genBusy}>{genBusy ? 'Generating…' : 'Generate now'}</button>
      </Field>
      <Field label="AI model">
        <span className="row-meta" style={{ maxWidth: 200, wordBreak: 'break-all' }}>{model}</span>
      </Field>
      <Field label="Run schedule">
        <span className="row-meta">Daily 7 AM, hourly 8 AM–11 PM US/Central</span>
      </Field>
      <Field label="Push digest to Pushover" desc="Send the summary to your phone at a set time.">
        <Toggle checked={!!form.digest_pushover_enabled} onChange={v => onChange('digest_pushover_enabled', v)} />
      </Field>
      <Field label="Digest push time" desc="Requires Pushover credentials configured above.">
        <select className="inp" value={form.digest_pushover_hour ?? 7} onChange={e => onChange('digest_pushover_hour', Number(e.target.value))}>
          {digestHours.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
    </Card>
  );
}
