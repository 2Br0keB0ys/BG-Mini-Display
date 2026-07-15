import { useState } from 'react';
import { colorForLevel } from '../lib/levelColors.js';

export default function LogRow({ row }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = row.msg.length > 120;

  return (
    <tr onClick={() => isLong && setExpanded((v) => !v)} className={isLong ? 'clickable' : ''}>
      <td className="col-ts">{row.ts}</td>
      <td className="col-lvl">
        <span className="badge" style={{ backgroundColor: colorForLevel(row.lvl) }}>
          {row.lvl}
        </span>
      </td>
      <td className="col-feat">{row.feat}</td>
      <td className="col-msg">{expanded || !isLong ? row.msg : `${row.msg.slice(0, 120)}...`}</td>
    </tr>
  );
}
