const start = performance.now();
while (performance.now() - start < 500) {
  // Keep this renderer busy while the sibling page starts executing.
}

throw new Error('concurrent browser coverage fatal');
