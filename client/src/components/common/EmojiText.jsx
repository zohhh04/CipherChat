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
