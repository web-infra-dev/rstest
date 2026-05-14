import { html } from 'satori-html';

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 630;

export interface TemplateOptions {
  version: string;
  description?: string;
  logoDataUrl: string;
  backgroundDataUrl: string;
}

/**
 * The background is a pre-rendered PNG (icons + vignette baked together)
 * placed as an absolutely-positioned `<img>` behind the content — satori's
 * `background-image: url(...)` shorthand stumbles on data URIs but handles
 * `<img src="data:image/png;...">` reliably.
 *
 * satori quirk: every container needs an explicit `display: flex`, since
 * satori treats undeclared display as `none`.
 */
export function buildTemplate({
  version,
  description,
  logoDataUrl,
  backgroundDataUrl,
}: TemplateOptions) {
  return html`
    <div
      style="
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: ${CANVAS_WIDTH}px;
        height: ${CANVAS_HEIGHT}px;
        padding: 64px 80px;
        background-color: #ffffff;
        font-family: 'Space Grotesk';
        text-align: center;
      "
    >
      <img
        src="${backgroundDataUrl}"
        style="
          position: absolute;
          top: 0;
          left: 0;
          width: ${CANVAS_WIDTH}px;
          height: ${CANVAS_HEIGHT}px;
        "
      />
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
