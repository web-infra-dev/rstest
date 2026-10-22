import { useLang, useNavigate } from '@rspress/core/runtime';
import { useEffect, useRef } from 'react';
import { useI18nUrl } from '../components/utils';

type Adapter = 'rsbuild' | 'rslib' | 'rspack' | 'lynx' | 'modernjs';

// Rsbuild, Rslib and Rspack have pages on this site; Lynx and Modern.js document
// their adapters (withLynxConfig, withModernConfig) on their own sites.
const EXTERNAL: Record<'lynx' | 'modernjs', { en: string; zh: string }> = {
  lynx: {
    en: 'https://lynxjs.org/react/reactlynx-testing-library',
    zh: 'https://lynxjs.org/zh/react/reactlynx-testing-library',
  },
  modernjs: {
    en: 'https://modernjs.dev/guides/basic-features/testing/rstest',
    zh: 'https://modernjs.dev/zh/guides/basic-features/testing/rstest',
  },
};

// Adapter cables patched into the Rstest panel. The drawing lives in
// `hairline/patch.js`; its constants (layout, logos, port colors) are tuned there.
export function AdaptersPatchFigure({
  className = '',
}: {
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const lang = useLang() === 'zh' ? 'zh' : 'en';
  const tUrl = useI18nUrl();
  const navigate = useNavigate();
  // The figure mounts once; clicks read the latest language through this ref.
  const pick = useRef<(name: Adapter) => void>(() => {});
  pick.current = (name) => {
    if (name === 'lynx' || name === 'modernjs')
      window.open(EXTERNAL[name][lang], '_blank', 'noopener');
    else navigate(tUrl(`/integration/${name}/`));
  };

  // Client only: the engine is loaded on mount, so SSG renders just the empty
  // box and never imports it.
  useEffect(() => {
    let destroy: (() => void) | undefined;
    let cancelled = false;
    import('./hairline/patch.js').then(({ mountPatch }) => {
      if (cancelled || !host.current) return;
      destroy = mountPatch(host.current, {
        value: 2,
        play: true,
        onPick: (name) => pick.current(name),
      });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  // The drawing spans y 59 to 254 of the 320-tall viewBox. Crop the empty bands
  // with negative margins (percentages of the width: 48 and 56 of 400) instead of
  // resizing the stage, whose box the kernel maps pointer coordinates against.
  return (
    <div
      className={`flex min-w-0 items-center justify-center bg-surface p-6 ${className}`}
    >
      <div className="w-full max-w-[480px] overflow-hidden">
        <div
          ref={host}
          className="-mt-[12%] -mb-[14%] aspect-[5/4] [--hairline-plate:var(--rp-c-bg)]"
        />
      </div>
    </div>
  );
}
