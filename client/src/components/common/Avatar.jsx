import { initialsOf, colorFor } from '../../utils/format';

export default function Avatar({ id, name, size = 40, online, avatar }) {
  const bg = colorFor(id);
  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      {avatar ? (
        <img
          className="avatar avatar-img"
          src={avatar}
          alt={name}
          style={{ width: size, height: size, boxShadow: `0 2px 8px ${bg}44` }}
        />
      ) : (
        <div
          className="avatar"
          style={{
            background: `linear-gradient(135deg, ${bg}, ${bg}dd)`,
            fontSize: size * 0.38,
            boxShadow: `0 2px 8px ${bg}44`,
          }}
        >
          {initialsOf(name)}
        </div>
      )}
      {online ? <span className="presence-dot" /> : null}
    </div>
  );
}
