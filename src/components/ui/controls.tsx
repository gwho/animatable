import type { ReactNode } from 'react';

export function Button({
  onClick,
  children,
  variant = 'default',
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: 'default' | 'primary';
  ariaLabel?: string;
}) {
  const tone =
    variant === 'primary'
      ? 'bg-emerald-600 text-white hover:bg-emerald-500'
      : 'bg-slate-800 text-slate-200 hover:bg-slate-700';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tone}`}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  accent = 'text-slate-300',
  aside,
  children,
  className = '',
}: {
  title: string;
  accent?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Slider(props: {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-slate-300">{props.label}</span>
      <input
        type="range"
        className="w-full accent-slate-300"
        aria-label={props.ariaLabel}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Segmented<T extends string>(props: {
  label: ReactNode;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-slate-300">{props.label}</span>
      <div className="flex gap-1" role="radiogroup">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            onClick={() => props.onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded px-2 py-1 text-xs transition-colors ${
              props.value === o.value ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
