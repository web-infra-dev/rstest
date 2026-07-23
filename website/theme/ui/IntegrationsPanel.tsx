import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';

type Integration = {
  id: string;
  name: string;
  /** The adapter call a user writes in `extends`. */
  api: string;
  logo: string;
  /** Only for logos that would disappear against a dark background. */
  logoDark?: string;
  dashed?: boolean;
};

const INTERVAL_MS = 1800;

/** Toasts kept in the feed before the oldest scrolls out of the top. */
const VISIBLE = 4;

function Logo({
  src,
  srcDark,
  className,
}: {
  src: string;
  srcDark?: string;
  className: string;
}) {
  if (!srcDark) {
    return <img src={src} alt="" className={className} />;
  }
  return (
    <>
      <img src={src} alt="" className={`${className} dark:hidden`} />
      <img src={srcDark} alt="" className={`hidden ${className} dark:block`} />
    </>
  );
}

export function IntegrationsPanel({
  integrations,
  hostLogo,
}: {
  integrations: Integration[];
  hostLogo: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reducedMotion = useReducedMotion();
  const [tick, setTick] = useState(VISIBLE - 1);

  useEffect(() => {
    if (!inView || reducedMotion) {
      return;
    }
    const timer = setInterval(() => setTick((n) => n + 1), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inView, reducedMotion]);

  const feed = Array.from(
    { length: VISIBLE },
    (_, i) => tick - VISIBLE + 1 + i,
  );

  return (
    <div
      ref={ref}
      className="flex h-full flex-col justify-end gap-3 overflow-hidden p-6"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {feed.map((n) => {
          const depth = tick - n;
          const item = integrations[n % integrations.length]!;
          return (
            <motion.div
              layout
              key={n}
              className={`flex items-center gap-4 rounded-lg border bg-surface px-5 py-4 ${
                item.dashed ? 'border-dashed border-line-strong' : 'border-line'
              }`}
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              animate={{ opacity: 1 - depth * 0.2, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            >
              {item.dashed ? (
                <span className="size-8 shrink-0 rounded border border-dashed border-fg-subtle" />
              ) : (
                <Logo
                  src={item.logo}
                  srcDark={item.logoDark}
                  className="size-8 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-fg">
                  {item.name}
                </div>
                <div className="truncate font-mono text-[13px] text-fg-subtle">
                  {item.api}
                </div>
              </div>
              <img src={hostLogo} alt="" className="size-7 shrink-0" />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
