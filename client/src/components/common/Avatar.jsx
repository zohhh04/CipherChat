import { initialsOf, colorFor } from '../../utils/format';

export default function Avatar({ id, name, size = 40, online }) {
  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      <div className="avatar" style={{ background: colorFor(id), fontSize: size * 0.38 }}>
        {initialsOf(name)}
      </div>
      {online ? <span className="presence-dot" /> : null}
    </div>
  );
}
