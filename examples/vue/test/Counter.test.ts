import { expect, test } from '@rstest/core';
import { mount } from '@vue/test-utils';
import Counter from '../src/Counter.vue';

test('renders Counter with initial count of 0', () => {
  const wrapper = mount(Counter);
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 0');
});

test('renders Counter with custom initial count', () => {
  const wrapper = mount(Counter, {
    props: {
      initialCount: 5,
    },
  });
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 5');
});

test('increments counter on button click', async () => {
  const wrapper = mount(Counter);

  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 0');

  await wrapper.find('button').trigger('click');
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 1');

  await wrapper.find('button').trigger('click');
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 2');
});
