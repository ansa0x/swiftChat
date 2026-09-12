// Photo when there is one, initial-letter placeholder otherwise. Decorative in
// every current usage — the username is always rendered alongside it — so the
// image carries an empty alt rather than duplicating that text for a screen
// reader.
const Avatar = ({ src, name, size = 28, className = "" }) => {
  const dimensions = { width: size, height: size };

  if (src) {
    return (
      <img
        className={`avatar ${className}`.trim()}
        style={dimensions}
        src={src}
        alt=""
        loading="lazy"
      />
    );
  }

  return (
    <span
      className={`avatar avatar-fallback ${className}`.trim()}
      style={{ ...dimensions, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      aria-hidden="true"
    >
      {(name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
};

export default Avatar;
