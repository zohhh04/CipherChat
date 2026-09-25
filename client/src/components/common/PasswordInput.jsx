import { useState } from 'react';

// Password field with an eye toggle to show / hide the value.
// Accepts all regular <input> props (value, onChange, placeholder, ...).
// Layout props (flex, minWidth, ...) go on the wrapper via wrapperStyle.
export default function PasswordInput({ className = '', wrapperStyle, wrapperClassName = '', ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <span className={`password-wrap ${wrapperClassName}`.trim()} style={wrapperStyle}>
      <input
        {...rest}
        type={show ? 'text' : 'password'}
        className={`text-input password-field ${className}`.trim()}
      />
      <button
        type="button"
        className="password-eye"
        onClick={() => setShow((s) => !s)}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? '🙈' : '👁️'}
      </button>
    </span>
  );
}
