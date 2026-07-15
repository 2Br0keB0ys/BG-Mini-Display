// Parses the JSON-lines diagnostic log format written by
// firmware/src/sd_logger.h: {"ts","ms","lvl","feat","msg"} per line.

export function parseLogLine(line) {
  try {
    const obj = JSON.parse(line);
    return {
      ts: obj.ts || '',
      ms: obj.ms ?? null,
      lvl: obj.lvl || '',
      feat: obj.feat || '',
      msg: obj.msg || '',
    };
  } catch {
    return null;
  }
}

// GET /api/admin/logs/latest -> { meta, total, preview: [rawLine, ...] }
export function rowsFromLatest(response) {
  if (!response || !Array.isArray(response.preview)) return [];
  const uploadId = response.meta?.uploadedAt ?? null;
  return response.preview
    .map(parseLogLine)
    .filter(Boolean)
    .map((row) => ({ ...row, source: 'latest', uploadId }));
}

// GET /api/admin/logs/all?download=1&format=json
// -> { generatedAt, included, totalAvailable, logs: [{uploadedAt, lineCount, bytes, commandId, key, text}] }
export function rowsFromHistory(response) {
  if (!response || !Array.isArray(response.logs)) return [];
  const rows = [];
  for (const entry of response.logs) {
    const uploadId = entry.uploadedAt ?? entry.key;
    const lines = String(entry.text || '')
      .split('\n')
      .filter(Boolean);
    for (const line of lines) {
      const row = parseLogLine(line);
      if (row) rows.push({ ...row, source: 'history', uploadId });
    }
  }
  return rows;
}
