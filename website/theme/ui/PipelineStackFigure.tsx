import { useEffect, useRef } from 'react';

// Rspack, Rsbuild and Rstest bricks snapping into one stack. The drawing lives
// in `hairline/stack.js`; its constants (timing, colors, sparks) are tuned there.
export function PipelineStackFigure({
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
    import('./hairline/stack.js').then(({ mountStack }) => {
      if (cancelled || !host.current) return;
      destroy = mountStack(host.current, { lift: 22, play: true });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // The drawing spans y 56 to 307 of the 320-tall viewBox, at its tallest (the
  // bricks apart). Crop the empty bands with negative margins (percentages of the
  // width: 48 and 8 of 400) instead of resizing the stage, whose box the kernel
  // maps pointer coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[480px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[12%] -mb-[2%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
