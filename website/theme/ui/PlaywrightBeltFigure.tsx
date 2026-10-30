import { useEffect, useRef } from 'react';

// Unit, DOM, browser and Playwright tests on one belt under one stamping press.
// The drawing lives in `hairline/belt.js`; its constants (layout, icons, lamp
// and stamp colors) are tuned there.
export function PlaywrightBeltFigure({
  className = '',
}: {
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  // Client only: the engine is loaded on mount, so SSG renders just the empty
  // box and never imports it.
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import('./hairline/belt.js').then(({ mountBelt }) => {
      if (cancelled || !host.current) return;
      // No tour: its unseen pointer would slow the belt whenever it stops on
      // it, so only a real hover slows it.
      destroy = mountBelt(host.current, { value: 0.2, play: false });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // The drawing spans y 76 to 254 of the 320-tall viewBox. Crop the empty bands
  // with negative margins (percentages of the width: 66 and 56 of 400) instead of
  // resizing the stage, whose box the kernel maps pointer coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[480px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[16.5%] -mb-[14%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
