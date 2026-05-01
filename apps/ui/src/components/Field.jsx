export default function Field({ label, desc, children, sub }) {
  const cls = sub ? 'subrow' : 'field-row';
  return (
    <div className={cls}>
      <div className="field-label">
        <div className="field-name">{label}</div>
        {desc && <div className="field-desc">{desc}</div>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}

export function Tip({ children }) {
  return <div className="helper-tip">{children}</div>;
}
