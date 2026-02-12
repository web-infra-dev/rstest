export const loadWASM = async () => {
  const wasmUrl = new URL('./factorial.wasm', import.meta.url);
  const { _Z4facti: AsyncFactorial } = await import(wasmUrl.href);
  return AsyncFactorial;
};
