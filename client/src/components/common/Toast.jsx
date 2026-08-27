import { useEffect, useState } from 'react';

let toastId = 0;

export function toast(message, kind = 'info') {
  window.dispatchEvent(new CustomEvent('sc-toast', { detail: { id: ++toastId, message, kind } }));
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      setToasts((prev) => [...prev.slice(-4), t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 4000);
    };
    window.addEventListener('sc-toast', handler);
    return () => window.removeEventListener('sc-toast', handler);
  }, []);

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
