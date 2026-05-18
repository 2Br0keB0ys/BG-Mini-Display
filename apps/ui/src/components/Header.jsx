import { UI_VERSION } from '../constants';
import { fmtTs } from '../helpers';

export default function Header({ meta, saving, onSave }) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="logo">
          <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z"/></svg>
        </div>
        <div>
          <div className="header-title">
            BG MiniView <span className="header-ver">v{UI_VERSION}</span>
          </div>
          <div className="header-meta">Last update: {fmtTs(meta.configUpdatedAt)}</div>
        </div>
        <button className="btn-save" onClick={onSave} disabled={saving} style={{ marginLeft: 8, flexShrink: 0 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </header>
  );
}
