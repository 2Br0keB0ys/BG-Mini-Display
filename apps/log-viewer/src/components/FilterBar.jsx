export default function FilterBar({
  search,
  onSearchChange,
  levels,
  selectedLevels,
  onToggleLevel,
  features,
  selectedFeatures,
  onToggleFeature,
}) {
  return (
    <div className="panel filter-bar">
      <input
        type="text"
        placeholder="Search message text..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <div className="chip-group">
        {levels.map((lvl) => (
          <label key={lvl} className="chip">
            <input
              type="checkbox"
              checked={selectedLevels.has(lvl)}
              onChange={() => onToggleLevel(lvl)}
            />
            {lvl}
          </label>
        ))}
      </div>
      {features.length > 0 && (
        <div className="chip-group">
          {features.map((feat) => (
            <label key={feat} className="chip">
              <input
                type="checkbox"
                checked={selectedFeatures.has(feat)}
                onChange={() => onToggleFeature(feat)}
              />
              {feat}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
