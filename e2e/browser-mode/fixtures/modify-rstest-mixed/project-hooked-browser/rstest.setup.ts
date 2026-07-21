const globalWithSetupCount = globalThis as typeof globalThis & {
  __hookedBrowserSetupCount?: number;
};

globalWithSetupCount.__hookedBrowserSetupCount =
  (globalWithSetupCount.__hookedBrowserSetupCount ?? 0) + 1;
