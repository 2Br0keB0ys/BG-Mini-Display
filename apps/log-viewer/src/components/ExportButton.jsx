import { downloadCsv } from '../lib/exportCsv.js';

export default function ExportButton({ rows }) {
  return (
    <button disabled={!rows.length} onClick={() => downloadCsv(rows)}>
      Export CSV ({rows.length})
    </button>
  );
}
