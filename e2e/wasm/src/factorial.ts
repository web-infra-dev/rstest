export const loadWASM = async () => {
  const wasmUrl = new URL('./factorial.wasm', import.meta.url);
  return import(wasmUrl.href);
};
