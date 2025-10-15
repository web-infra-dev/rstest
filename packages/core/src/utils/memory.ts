import process from 'node:process';

const DefaultMaxHeapSize = 1024 * 1024 * 1024;

export function isMemorySufficient(options?: {
  memoryThreshold: number; // memory usage threshold, above which it is considered memory tight
  maxHeapSize: number; // 1GB maximum heap memory
}): boolean {
  const { memoryThreshold = 0.7, maxHeapSize = DefaultMaxHeapSize } =
    options || {};
  if (!process?.memoryUsage) {
    return true;
  }

  const memoryUsage = process.memoryUsage();
  const heapUsed = memoryUsage.heapUsed;
  const heapTotal = memoryUsage.heapTotal;

  // Calculate memory usage ratio
  const memoryUsageRatio = heapUsed / heapTotal;

  // Check if memory usage ratio exceeds threshold or heap used exceeds max heap size
  const isMemorySufficient =
    memoryUsageRatio < memoryThreshold && heapUsed < maxHeapSize;
  return isMemorySufficient;
}
