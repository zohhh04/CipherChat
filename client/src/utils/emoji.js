import twemoji from 'twemoji';

const twemojiOptions = {
  folder: 'svg',
  ext: '.svg',
  base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
};

export function parseEmojiToHtml(text) {
  if (!text) return '';
  return twemoji.parse(text, twemojiOptions);
}

export function emojiSvgUrl(emoji) {
  const node = twemoji.parse(emoji, { ...twemojiOptions, callback: (icon, opts) => false });
  const match = node.match(/src="([^"]+)"/);
  return match ? match[1] : null;
}
