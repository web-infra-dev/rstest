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
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary';
  LinkComp?: LinkComp;
  children: ReactNode;
}) {
  const className = [
    'inline-flex h-[38px] items-center justify-center rounded-lg px-4 text-[15px] font-medium transition-colors',
    variant === 'primary'
      ? 'bg-brand text-white hover:bg-brand-dark dark:text-[#012b20]'
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
  index,
  eyebrow,
  description,
  children,
}: {
  index?: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
      {(eyebrow || description) && (
        <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          {eyebrow && (
            <h2 className="font-mono text-xs tracking-widest text-fg-muted uppercase">
              {index && <span className="mr-2 text-brand">{index}</span>}
              {eyebrow}
            </h2>
          )}
          {description && (
            <p className="text-[15px] text-fg-muted">{description}</p>
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
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col bg-surface p-6">
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 text-[13px]/[1.6] text-fg-muted">{description}</p>
    </div>
  );
}

/** The copy half of a feature block: title, body, optional chips, and a docs link. */
export function FeatureText({
  title,
  href,
  linkLabel,
  LinkComp,
  className = '',
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  LinkComp: LinkComp;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-center bg-surface p-6 sm:p-8 lg:p-10 ${className}`}
    >
      <h3 className="text-[22px]/[1.3] font-semibold tracking-tight text-fg">
        {title}
      </h3>
      {children}
      <LinkComp
        href={href}
        className="group mt-6 inline-flex w-fit items-center gap-1 text-[13px] font-medium text-brand"
      >
        {linkLabel}
        <span
          aria-hidden
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </LinkComp>
    </div>
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
}: {
  prompt: string;
  args: string;
}) {
  const tabs = ['prompt', ...PACKAGE_MANAGERS];
  const lineOf = (tab: string) =>
    tab === 'prompt' ? prompt : `${tab} ${args}`;
  const [tab, setTab] = useState(tabs[0]);
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
    <div className="w-[min(100%,680px)] text-left">
      <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
        <div className="relative flex items-center border-b border-line px-2 font-mono text-[12px]">
          {tabs.map((name) => (
            <button
              key={name}
              ref={(el) => {
                if (el) tabRefs.current.set(name, el);
              }}
              type="button"
              aria-pressed={name === tab}
              onClick={() => select(name)}
              className={`bg-transparent! px-2.5 py-2.5 transition-colors ${
                name === tab ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {name}
            </button>
          ))}
          <span
            aria-hidden
            className="absolute bottom-[-1px] h-px bg-brand"
            style={indicator}
          />
          <button
            type="button"
            onClick={copy}
            aria-label={
              copied
                ? 'Copied'
                : `Copy ${tab === 'prompt' ? 'prompt' : 'command'}`
            }
            className={`ml-auto flex items-center gap-1.5 rounded-md bg-transparent! px-2 py-1 transition-colors hover:bg-surface-mute! ${
              copied ? 'text-brand' : 'text-fg-subtle hover:text-fg'
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
        <div className="flex gap-3 px-4 py-3.5 font-mono text-[13px]/[1.6]">
          <span className="text-brand select-none">
            {tab === 'prompt' ? '>' : '$'}
          </span>
          {/* Every tab's full line sits in one grid cell, so the box keeps the tallest one's height while typing. */}
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
