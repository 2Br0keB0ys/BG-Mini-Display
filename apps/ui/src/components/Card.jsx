export default function Card({ iconClass, icon, title, sub, children }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className={`card-icon ${iconClass}`}>{icon}</div>
        <div>
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
