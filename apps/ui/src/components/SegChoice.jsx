export default function SegChoice({ options, value, onChange }) {
  const cur = String(value ?? '');
  return (
    <div className="choice-group">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={`choice-pill${String(v) === cur ? ' active' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
