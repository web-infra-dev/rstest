import type { ComponentType, ReactNode } from 'react';

export type LinkComp = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
}>;

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1 font-mono text-xs tracking-tight text-fg-muted">
      {children}
    </span>
  );
}

export function Button({
  href,
  variant = 'primary',
  LinkComp,
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary';
  LinkComp?: LinkComp;
  children: ReactNode;
}) {
  const className = [
    'inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold transition-colors',
    variant === 'primary'
      ? 'bg-brand text-white hover:bg-brand-light'
      : 'border border-line-strong text-fg hover:bg-surface-soft',
  ].join(' ');

  const Comp = LinkComp ?? 'a';
  return (
    <Comp href={href} className={className}>
      {children}
    </Comp>
  );
}

export function Section({
  eyebrow,
  description,
  children,
}: {
  eyebrow?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-8">
      {(eyebrow || description) && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {eyebrow && (
            <h2 className="font-mono text-xs tracking-widest text-fg-subtle uppercase">
              {eyebrow}
            </h2>
          )}
          {description && (
            <p className="text-sm text-fg-muted">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Hairline matrix: the 1px gaps show `bg-line` through, so cells need no fill. */
export function Grid({
  columns,
  children,
}: {
  columns: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-px border border-line bg-line ${columns}`}>
      {children}
    </div>
  );
}

export function Cell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col bg-surface p-5">
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-[13px]/[1.6] text-fg-muted">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </span>
  );
}

export function Window({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  // min-w-0 lets the grid track shrink so the pre can scroll instead of overflowing.
  return (
    <div className="min-w-0 bg-surface">
      <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] tracking-tight text-fg-subtle">
        {title}
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px]/[1.7]">
        {children}
      </pre>
    </div>
  );
}
