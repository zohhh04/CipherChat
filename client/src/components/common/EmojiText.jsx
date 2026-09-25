import { useRef, useEffect } from 'react';
import twemoji from 'twemoji';

const TWEMOJI_OPTIONS = {
  folder: 'svg',
  ext: '.svg',
  base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
};

export default function EmojiText({ text, className, style }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && text) {
      ref.current.innerHTML = twemoji.parse(text, TWEMOJI_OPTIONS);
    }
  }, [text]);

  return <span ref={ref} className={className} style={style} />;
}

export function Twemoji({ children, className, style, size }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && children) {
      ref.current.innerHTML = twemoji.parse(String(children), TWEMOJI_OPTIONS);
    }
  }, [children]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
        ...style,
      }}
    >
      {typeof children === 'string' ? undefined : children}
    </span>
  );
}

export function EmojiImg({ emoji, size = 20, className, style }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && emoji) {
      ref.current.innerHTML = twemoji.parse(emoji, TWEMOJI_OPTIONS);
    }
  }, [emoji]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        fontSize: size,
        ...style,
      }}
    />
  );
}

// Slightly restyled dustbin — outline trash-can (same meaning, a little different look).
export function TrashIcon({ size = 17, className = '', style }) {
  return (
    <svg
      className={`trash-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', ...style }}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
