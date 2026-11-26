import type { ScreenshotComparison } from '@rstest/browser/protocol';
import stripAnsi from 'strip-ansi';
import type { TestErrors } from '../types';
import type { CaseInfo } from '../utils/constants';
import { ScreenshotPreview } from './ScreenshotPreview';

export function FailureDetails({
  comparisons,
  fileErrors,
  cases,
}: {
  comparisons?: ReadonlyMap<string, ScreenshotComparison>;
  fileErrors?: TestErrors;
  cases: CaseInfo[];
}) {
  const failures = cases.flatMap((test) =>
    test.status === 'failed' && test.errors?.length
      ? [
          {
            id: test.id,
            title: [...test.parentNames, test.name].join(' › '),
            errors: test.errors,
          },
        ]
      : [],
  );

  if (fileErrors?.length) {
    failures.unshift({ id: 'file', title: 'File error', errors: fileErrors });
  }
  if (!failures.length) return null;

  return (
    <section
      aria-label="Failure details"
      data-testid="failure-details"
      className="max-h-[40%] has-[img]:max-h-[68%] shrink-0 overflow-auto border-0 border-t border-solid border-(--border) bg-(--background) px-4 py-3 text-(--foreground)"
    >
      {failures.map(({ id, title, errors }) => (
        <div key={id} className="mb-3 last:mb-0">
          <h3 className="m-0 text-sm font-semibold">{title}</h3>
          {errors.map((error, index) => {
            const images =
              error.screenshotComparisonId &&
              comparisons?.get(error.screenshotComparisonId);
            const message = stripAnsi(
              [error.name, error.message].filter(Boolean).join(': '),
            );
            return (
              <div
                key={error.screenshotComparisonId ?? index}
                className="mt-2 border-0 border-l-2 border-solid border-(--ds-red-700) pl-3 text-xs"
              >
                {images ? (
                  <ScreenshotPreview images={images} message={message} />
                ) : (
                  <pre className="m-0 wrap-anywhere whitespace-pre-wrap font-mono">
                    {message}
                  </pre>
                )}
                {error.diff && (
                  <pre className="mb-0 wrap-anywhere whitespace-pre-wrap font-mono">
                    {stripAnsi(error.diff)}
                  </pre>
                )}
                {error.stack && (
                  <details className="mt-2 text-(--accents-6)">
                    <summary
                      data-testid="failure-stack-toggle"
                      className="w-fit cursor-pointer"
                    >
                      Stack trace
                    </summary>
                    <pre className="mb-0 wrap-anywhere whitespace-pre-wrap font-mono">
                      {stripAnsi(error.stack)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
