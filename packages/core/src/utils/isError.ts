// Error constructors differ across test VMs and browser frames.
export const isError = (value: unknown): value is Error => {
  const tag = Object.prototype.toString.call(value);
  return (
    tag === '[object Error]' ||
    tag === '[object Exception]' ||
    tag === '[object DOMException]' ||
    value instanceof Error
  );
};
