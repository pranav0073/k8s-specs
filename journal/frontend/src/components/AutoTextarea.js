import { useEffect, useRef } from 'react';

export default function AutoTextarea({ value, onChange, className, style, ...props }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  useEffect(() => { resize(); }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onInput={resize}
      className={className}
      style={{ resize: 'none', overflow: 'hidden', ...style }}
      {...props}
    />
  );
}
