import LogRow from './LogRow.jsx';

export default function LogTable({ rows }) {
  if (!rows.length) {
    return <div className="empty-state">No log entries match the current filters.</div>;
  }
  return (
    <div className="log-table-wrapper">
      <table className="log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Feature</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <LogRow key={`${row.uploadId}-${i}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
