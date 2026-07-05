import { html } from 'satori-html';

export interface TemplateOptions {
  version: string;
  description?: string;
  logoDataUrl: string;
  background: string;
}

/**
 * Layout: 1200x630.
 *
 * Centered column over a white + soft-gradient background:
 *   - Header row: logo + "Rstest" wordmark side-by-side
 *   - v{version} (display-sized hero)
 *   - Description (free-form tagline)
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
}: TemplateOptions) {
  return html`
    <div
      style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 1200px;
        height: 630px;
        padding: 64px 80px;
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
            width: 96px;
            height: 96px;
          "
        />
        <div
          style="
            display: flex;
            font-size: 80px;
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
          font-size: 208px;
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
          display: ${description ? 'flex' : 'none'};
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
