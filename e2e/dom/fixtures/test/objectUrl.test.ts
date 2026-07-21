import { Blob as NodeBlob } from 'node:buffer';
import { expect, test } from '@rstest/core';

test('should create object URLs from Blob and File implementations', () => {
  expect(
    new URL('https://example.test/?key=value').searchParams,
  ).toBeInstanceOf(URLSearchParams);

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const IframeBlob = (iframe.contentWindow as unknown as { Blob: typeof Blob })
    .Blob;

  const objects = [
    new Blob(['blob'], { type: 'text/plain' }),
    new File(['file'], 'file.txt', { type: 'text/plain' }),
    new IframeBlob(['iframe blob'], { type: 'text/plain' }),
    new NodeBlob(['node blob'], { type: 'text/plain' }) as unknown as Blob,
  ];

  for (const object of objects) {
    const url = URL.createObjectURL(object);
    expect(url).toMatch(/^blob:nodedata:/);
    URL.revokeObjectURL(url);
  }

  iframe.remove();
});
