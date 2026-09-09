import { html } from 'satori-html';

/**
 * Fixed pixel geometry for a render target. `og` is the 1200x630 social card;
 * `banner` is the wider 2048x576 in-page blog banner. Both render at 2x zoom.
 */
export interface Layout {
  width: number;
  height: number;
  padding: string;
  logoSize: number;
  wordmarkSize: number;
  versionSize: number;
  /** Banners omit the tagline; the og card renders it when provided. */
  showDescription: boolean;
}

export const LAYOUTS = {
  og: {
    width: 1200,
    height: 630,
    padding: '64px 80px',
    logoSize: 96,
    wordmarkSize: 80,
    versionSize: 208,
    showDescription: true,
  },
  banner: {
    width: 2048,
    height: 576,
    padding: '48px 96px',
    logoSize: 92,
    wordmarkSize: 76,
    versionSize: 196,
    showDescription: false,
  },
} satisfies Record<string, Layout>;

export type LayoutName = keyof typeof LAYOUTS;

export interface TemplateOptions {
  version: string;
  description?: string;
  logoDataUrl: string;
  background: string;
  layout: Layout;
}

/**
 * Centered column over a white + soft-gradient background:
 *   - Header row: logo + "Rstest" wordmark side-by-side
 *   - v{version} (display-sized hero)
 *   - Description (og card only)
 *
 * design-resources has no rstest "logo + wordmark" combo SVG yet, so the
 * wordmark is rendered separately in Space Grotesk while the logo is fetched
 * at runtime from the canonical CDN URL.
 *
 * satori quirk: every container needs an explicit `display: flex`, since
 * satori treats undeclared display as `none`.
 */
export function buildTemplate({
  version,
  description,
  logoDataUrl,
  background,
  layout,
}: TemplateOptions) {
  const showDescription = layout.showDescription && !!description;
  return html`
    <div
      style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: ${layout.width}px;
        height: ${layout.height}px;
        padding: ${layout.padding};
        background: ${background};
        font-family: 'Space Grotesk';
        text-align: center;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          gap: 20px;
        "
      >
        <img
          src="${logoDataUrl}"
          style="
            width: ${layout.logoSize}px;
            height: ${layout.logoSize}px;
          "
        />
        <div
          style="
            display: flex;
            font-size: ${layout.wordmarkSize}px;
            font-weight: 700;
            letter-spacing: -0.03em;
            line-height: 1;
            color: #1a1a1a;
          "
        >
          Rstest
        </div>
      </div>

      <div
        style="
          display: flex;
          font-size: ${layout.versionSize}px;
          font-weight: 700;
          letter-spacing: -0.05em;
          line-height: 1;
          color: #0a0a0a;
          margin-top: 32px;
        "
      >
        v${version}
      </div>

      <div
        style="
          display: ${showDescription ? 'flex' : 'none'};
          font-size: 30px;
          font-weight: 400;
          color: #555555;
          margin-top: 32px;
          max-width: 900px;
          line-height: 1.4;
        "
      >
        ${description ?? ''}
      </div>
    </div>
  `;
}
