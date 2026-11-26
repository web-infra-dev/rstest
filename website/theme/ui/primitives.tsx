import {
  type ComponentType,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type LinkComp = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
}>;

export function Button({
  href,
  variant = 'primary',
  LinkComp,
  className = '',
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary';
  LinkComp?: LinkComp;
  className?: string;
  children: ReactNode;
}) {
  // Full-pill flat buttons contrast crisply against the sharp 0px hairline grid.
  const classes = [
    'group inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-medium transition-colors duration-150',
    variant === 'primary'
      ? 'bg-brand text-on-brand hover:bg-[var(--rp-c-brand-dark)]'
      : 'border border-[var(--home-border-strong)] bg-[var(--home-bg)] text-fg hover:border-fg/35 hover:bg-[var(--home-surface-hover)]',
    className,
  ].join(' ');

  const Comp = LinkComp ?? 'a';
  const external = href.startsWith('http');
  return (
    <Comp
      href={href}
      className={classes}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </Comp>
  );
}

/** Crisp 9px registration mark placed on structural rail intersections. */
export function Crosshair({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 9 9"
      aria-hidden
      className={`pointer-events-none absolute z-10 size-[9px] text-[var(--home-crosshair)] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M4.5 0v9M0 4.5h9" />
    </svg>
  );
}

/** Full-width diagonal-hatch separator inside the architectural rails. */
export function HatchBand() {
  return (
    <div className="relative border-y border-[var(--home-border)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="home-hatch relative h-6 border-x border-[var(--home-border)] sm:h-8">
          <Crosshair className="-top-[5px] -left-[5px]" />
          <Crosshair className="-top-[5px] -right-[5px]" />
          <Crosshair className="-bottom-[5px] -left-[5px]" />
          <Crosshair className="-right-[5px] -bottom-[5px]" />
        </div>
      </div>
    </div>
  );
}

export function FeatureLink({
  href,
  label,
  LinkComp,
  className = '',
}: {
  href: string;
  label: string;
  LinkComp: LinkComp;
  className?: string;
}) {
  return (
    <LinkComp
      href={href}
      className={`group/link inline-flex w-fit items-center gap-1.5 font-mono text-[13px] font-medium text-brand transition-colors hover:text-[var(--rp-c-brand-dark)] ${className}`}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className="transition-transform duration-150 group-hover/link:translate-x-1"
      >
        →
      </span>
    </LinkComp>
  );
}

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * A copyable way to install: a coding-agent prompt first, then one command per package manager.
 * `args` follows the package manager, e.g. `add foo -D`.
 */
export function InstallCommand({
  prompt,
  args,
  className = '',
}: {
  prompt: string;
  args: string;
  className?: string;
}) {
  const tabs = ['prompt', ...PACKAGE_MANAGERS];
  const lineOf = (tab: string) =>
    tab === 'prompt' ? prompt : `${tab} ${args}`;
  const [tab, setTab] = useState('prompt');
  const [copied, setCopied] = useState(false);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const line = lineOf(tab);

  useLayoutEffect(() => {
    const el = tabRefs.current.get(tab);
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  const select = (next: string) => {
    if (next === tab) return;
    setTab(next);
    setCopied(false);
  };
  const copy = () => {
    navigator.clipboard.writeText(line).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`w-full text-left ${className}`}>
      <div className="border border-[var(--home-border-strong)] bg-[var(--home-bg)]">
        <div className="relative flex items-center justify-between gap-2 border-b border-[var(--home-border)] px-2 font-mono text-[12px]">
          <div className="relative flex items-center">
            {tabs.map((name) => (
              <button
                key={name}
                ref={(el) => {
                  if (el) tabRefs.current.set(name, el);
                }}
                type="button"
                aria-pressed={name === tab}
                onClick={() => select(name)}
                className={`cursor-pointer bg-transparent! px-2 py-2 transition-colors sm:px-2.5 ${
                  name === tab
                    ? 'font-medium text-fg'
                    : 'text-fg-muted/75 hover:text-fg'
                }`}
              >
                {name}
              </button>
            ))}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-[-1px] h-[2px] bg-brand transition-[transform,width] duration-200 ease-out"
              style={{
                width: indicator.width,
                transform: `translateX(${indicator.left}px)`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={copy}
            aria-label={
              copied
                ? 'Copied'
                : `Copy ${tab === 'prompt' ? 'prompt' : 'command'}`
            }
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 bg-transparent! px-2.5 py-1 transition-colors hover:bg-[var(--home-surface-hover)]! ${
              copied ? 'text-brand' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {copied ? (
                <path d="M3 8.5l3.2 3L13 4.5" />
              ) : (
                <>
                  <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                  <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
                </>
              )}
            </svg>
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
        <div className="flex items-start gap-3 bg-[var(--home-stage-bg)] px-4 py-2 font-mono text-[12.5px]/[1.5]">
          <span className="font-medium text-brand select-none">
            {tab === 'prompt' ? '>' : '$'}
          </span>
          {/* Every tab's full line sits in one grid cell, so the box keeps the tallest one's height. */}
          <div className="grid min-w-0 flex-1 break-words">
            {tabs.map((name) => (
              <span
                key={name}
                aria-hidden
                className="invisible [grid-area:1/1]"
              >
                {lineOf(name)}
              </span>
            ))}
            <code className="text-fg [grid-area:1/1]">{line}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
