import { useEffect, useRef } from 'react';
import twemoji from 'twemoji';

const TWEMOJI_OPTIONS = {
  folder: 'svg',
  ext: '.svg',
  base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
};

export function useTwemoji() {
  const observerRef = useRef(null);

  useEffect(() => {
    twemoji.parse(document.body, TWEMOJI_OPTIONS);

    observerRef.current = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            twemoji.parse(node, TWEMOJI_OPTIONS);
          }
        }
      }
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);
}
