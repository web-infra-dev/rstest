import { useEffect, useRef } from 'react';

// Test files moving from the Jest bin to the Rstest bin. The drawing lives in
// `hairline/migrate.js`; its constants (timing, colors, marks) are tuned there.
export function JestMigrateFigure({ className = '' }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  // Client only: the engine is loaded on mount, so SSG renders just the empty
  // box and never imports it.
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import('./hairline/migrate.js').then(({ mountMigrate }) => {
      if (cancelled || !host.current) return;
      destroy = mountMigrate(host.current, { stagger: 400, play: true });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // The drawing spans y 70 to 262 of the 320-tall viewBox. Crop the empty bands
  // with negative margins (percentages of the width: 56 and 44 of 400) instead of
  // resizing the stage, whose box the kernel maps pointer coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[480px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[14%] -mb-[11%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
