import { expect, test } from '@rstest/core';
import { mount } from '@vue/test-utils';
import App from '../src/App.vue';

test('renders App with default greeting', () => {
  const wrapper = mount(App);
  expect(wrapper.text()).toContain('Hello World');
  expect(wrapper.text()).toContain('Start building amazing things with Vue.');
});

test('renders App with custom greeting', () => {
  const wrapper = mount(App, {
    props: {
      greeting: 'Welcome to Vue',
    },
  });
  expect(wrapper.text()).toContain('Welcome to Vue');
  expect(wrapper.text()).not.toContain('Hello World');
});
