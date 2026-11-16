import { it } from '@rstest/core';

// Rejected while `rstest list` collects the file. Nothing waits for a
// macrotask afterwards, so Node reports it only after collection.
Promise.reject(new Error('COLLECT_REJECTION'));

it('is listed', () => {});
