import { expect, test } from '@rstest/core';
import { renderToString } from '@vue/test-utils';
import App from '../src/App.vue';

test('renders App with default greeting', async () => {
  const wrapper = await renderToString(App);
  expect(wrapper).toContain('Hello World');
  expect(wrapper).toContain('Start building amazing things with Vue.');
});

test('renders App with custom greeting', async () => {
  const wrapper = await renderToString(App, {
    props: {
      greeting: 'Welcome to Vue',
    },
  });
  expect(wrapper).toContain('Welcome to Vue');
  expect(wrapper).not.toContain('Hello World');
});
