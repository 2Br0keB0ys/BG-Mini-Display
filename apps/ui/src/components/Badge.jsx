export function Badge({ text, variant = 'blue' }) {
  return <span className={`badge badge-${variant}`}>{text}</span>;
}
