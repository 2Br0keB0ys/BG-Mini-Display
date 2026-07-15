const LEVEL_COLORS = {
  ERR: '#ef4444',
  SEC: '#f97316',
  WIFI: '#3b82f6',
  NET: '#3b82f6',
  BG: '#22c55e',
  SYS: '#94a3b8',
  HB: '#94a3b8',
};

export function colorForLevel(lvl) {
  return LEVEL_COLORS[lvl] || '#94a3b8';
}
