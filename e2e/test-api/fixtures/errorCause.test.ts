import { it } from '@rstest/core';

const request = () => {
  try {
    throw new TypeError('fetch failed');
  } catch (cause) {
    throw new Error('Request failed', { cause });
  }
};

const loadUser = () => {
  try {
    request();
  } catch (cause) {
    throw new Error('Failed to load the user', { cause });
  }
};

it('prints the cause chain', () => {
  loadUser();
});

it('prints an error without a cause', () => {
  throw new Error('no cause');
});
