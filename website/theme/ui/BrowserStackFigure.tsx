import { useEffect, useRef } from 'react';

// Three real browsers in a stack, taking turns on top. The drawing lives in
// `hairline/browsers.js`; its constants (timing, heights, logos) are tuned there.
export function BrowserStackFigure({ className = '' }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  // Client only: the engine is loaded on mount, so SSG renders just the empty
  // box and never imports it.
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import('./hairline/browsers.js').then(({ mountBrowsers }) => {
      if (cancelled || !host.current) return;
      destroy = mountBrowsers(host.current, { gap: 14, play: true });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // Over a full lap the landed windows span y 112 to 288 of the 320-tall
  // viewBox; a window coming back drops in from above the crop. Crop the empty
  // bands with negative margins (percentages of the width: 104 and 26 of 400)
  // instead of resizing the stage, whose box the kernel maps pointer
  // coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[480px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[26%] -mb-[6.5%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
