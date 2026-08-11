import { expect, it } from '@rstest/core';

const appendMappedScript = ({
  code,
  source,
  sourceContent,
  url,
}: {
  code: string;
  source: string;
  sourceContent: string;
  url: string;
}): HTMLScriptElement => {
  const sourceMap = {
    version: 3,
    names: [],
    sources: [`webpack:///./src/${source}`],
    sourcesContent: [sourceContent],
    mappings: 'AAAA',
  };
  const script = document.createElement('script');
  script.textContent = [
    code,
    `//# sourceMappingURL=data:application/json;base64,${btoa(
      JSON.stringify(sourceMap),
    )}`,
    `//# sourceURL=${url}`,
  ].join('\n');
  document.head.append(script);
  return script;
};

it('collects query-dependent HTTP script variants', () => {
  const scripts = [
    appendMappedScript({
      code: "Reflect.set(globalThis, '__RSTEST_QUERY_A__', 'a');",
      source: 'query-a.ts',
      sourceContent: "export const queryA = 'a';",
      url: `${location.origin}/query-variant.js?variant=a`,
    }),
    appendMappedScript({
      code: "Reflect.set(globalThis, '__RSTEST_QUERY_B__', 'b');",
      source: 'query-b.ts',
      sourceContent: "export const queryB = 'b';",
      url: `${location.origin}/query-variant.js?variant=b`,
    }),
  ];

  try {
    expect(Reflect.get(globalThis, '__RSTEST_QUERY_A__')).toBe('a');
    expect(Reflect.get(globalThis, '__RSTEST_QUERY_B__')).toBe('b');
  } finally {
    scripts.forEach((script) => script.remove());
    Reflect.deleteProperty(globalThis, '__RSTEST_QUERY_A__');
    Reflect.deleteProperty(globalThis, '__RSTEST_QUERY_B__');
  }
});

it('collects a classic HTTP script', () => {
  const script = appendMappedScript({
    code: `with ({ value: 42 }) {
  Reflect.set(globalThis, '__RSTEST_CLASSIC__', value);
}`,
    source: 'classic.ts',
    sourceContent: 'export const classic = 42;',
    url: `${location.origin}/classic.js`,
  });

  try {
    expect(Reflect.get(globalThis, '__RSTEST_CLASSIC__')).toBe(42);
  } finally {
    script.remove();
    Reflect.deleteProperty(globalThis, '__RSTEST_CLASSIC__');
  }
});
