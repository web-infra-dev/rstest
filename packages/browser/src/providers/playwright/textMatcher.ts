export const reviveBrowserLocatorText = (
  text:
    | { type: 'string'; value: string }
    | { type: 'regexp'; source: string; flags?: string },
): string | RegExp => {
  if (text.type === 'string') {
    return text.value;
  }
  return new RegExp(text.source, text.flags);
};
