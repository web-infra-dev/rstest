import type { ScreenshotComparison } from '@rstest/browser/protocol';
import { useRef, useState } from 'react';

export function ScreenshotPreview({
  images,
  message,
}: {
  images: ScreenshotComparison;
  message: string;
}) {
  const [highlight, setHighlight] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [enlarged, setEnlarged] = useState<{ label: string; png: string }>();
  const [summary, ...details] = message.split('\n');
  const diffLabel = images.sharedSize ? 'Pixel diff' : 'Comparison image';

  function openImage(label: string, png: string) {
    setEnlarged({ label, png });
    dialog.current?.showModal();
  }

  return (
    <>
      <pre className="m-0 wrap-anywhere whitespace-pre-wrap font-mono">
        {summary}
      </pre>
      <div
        role="region"
        aria-label="Screenshot comparison"
        data-testid="screenshot-comparison"
        tabIndex={0}
        className="my-3 max-h-[min(55vh,34rem)] overflow-auto focus-visible:outline-(--ds-blue-700)"
      >
        <div className="sticky top-0 z-1 grid grid-cols-2 items-center gap-x-3 bg-(--background) pb-1.5">
          <span className="text-xs font-semibold">Expected</span>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs font-semibold">Actual</span>
            {images.regions && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-(--accents-6)">
                <input
                  type="checkbox"
                  checked={highlight}
                  onChange={(event) => setHighlight(event.target.checked)}
                  data-testid="screenshot-highlight-differences"
                  className="m-0 cursor-pointer accent-(--ds-blue-700)"
                />
                Highlight changes
              </label>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 items-start gap-x-3">
          {[
            {
              label: 'Expected',
              original: images.reference,
              preview: images.reference,
            },
            {
              label: 'Actual',
              original: images.actual,
              preview: (highlight && images.regions) || images.actual,
            },
          ].map(({ label, original, preview }) => (
            <button
              key={label}
              type="button"
              aria-label={`Open ${label.toLowerCase()} screenshot at original size`}
              data-testid={`screenshot-open-${label.toLowerCase()}`}
              onClick={() => openImage(label, original)}
              className="flex w-full min-w-0 cursor-zoom-in justify-center overflow-hidden rounded-md border border-solid border-(--border) bg-(--muted) p-1 focus-visible:outline-(--ds-blue-700)"
            >
              <img
                src={`data:image/png;base64,${preview}`}
                alt={`${label} screenshot`}
                className="block h-auto min-w-0 max-w-full self-start"
              />
            </button>
          ))}
        </div>
      </div>
      <details className="mt-2 text-(--accents-6)">
        <summary
          data-testid="screenshot-details-toggle"
          className="w-fit cursor-pointer"
        >
          Snapshot details
        </summary>
        <button
          type="button"
          data-testid="screenshot-open-diff"
          className="mt-2 cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-(--ds-blue-700) underline"
          onClick={() => openImage(diffLabel, images.diff)}
        >
          View {diffLabel.toLowerCase()}
        </button>
        {details.length > 0 && (
          <pre className="mb-0 wrap-anywhere whitespace-pre-wrap font-mono">
            {details.join('\n')}
          </pre>
        )}
      </details>
      <dialog
        ref={dialog}
        aria-label={enlarged?.label}
        onClose={() => setEnlarged(undefined)}
        className="m-auto max-h-[92vh] max-w-[94vw] overflow-hidden rounded-lg border border-solid border-(--border) bg-(--background) p-0 text-(--foreground) shadow-xl backdrop:backdrop-brightness-50"
      >
        <div className="flex items-center justify-between gap-6 border-0 border-b border-solid border-(--border) px-3 py-2 text-sm">
          <strong>{enlarged?.label}</strong>
          <form method="dialog" className="m-0">
            <button
              type="submit"
              data-testid="screenshot-close-image"
              className="cursor-pointer rounded border-0 bg-(--muted) px-2 py-1 text-xs text-(--foreground)"
            >
              Close
            </button>
          </form>
        </div>
        {enlarged && (
          <div className="max-h-[80vh] overflow-auto bg-(--muted)">
            <img
              src={`data:image/png;base64,${enlarged.png}`}
              alt={enlarged.label}
              className="block max-w-none"
            />
          </div>
        )}
      </dialog>
    </>
  );
}
