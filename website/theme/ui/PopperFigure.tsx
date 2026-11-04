import { useEffect, useRef } from 'react';

// An open box with the Rstest mascot on its side keeps popping the tools Rstest
// works with. The drawing lives in `hairline/popper.js`; the box, the arcs and
// the pace are tuned there.
export function PopperFigure({ className = '' }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  // Client only: the engine is loaded on mount, so SSG renders just the empty
  // box and never imports it.
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import('./hairline/popper.js').then(({ mountPopper }) => {
      if (cancelled || !host.current) return;
      // Plays on its own; only a real hover slows it.
      destroy = mountPopper(host.current, { value: 0.2, play: true });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // The arcs stay below y 50 of the 320-tall viewBox (a tile reaches up to 35)
  // and the box ends near y 304. Crop the empty bands with negative margins
  // (percentages of the width: 32 and 8 of 400) instead of resizing the stage,
  // whose box the kernel maps pointer coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[360px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[8%] -mb-[2%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
