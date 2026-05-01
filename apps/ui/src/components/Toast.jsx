export default function Toast({ msg, show }) {
  return <div className={`toast${show ? ' show' : ''}`}>{msg}</div>;
}
