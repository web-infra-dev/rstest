import { expect, test } from '@rstest/core';
import { mount } from '@vue/test-utils';
import CounterJsx from '../src/Counter.tsx';

test('renders JSX Counter with initial count of 0', () => {
  const wrapper = mount(CounterJsx);
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 0');
});

test('renders JSX Counter with custom initial count', () => {
  const wrapper = mount(CounterJsx, {
    props: {
      initialCount: 10,
    },
  });
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 10');
});

test('JSX Counter increments and emits event', async () => {
  const wrapper = mount(CounterJsx);

  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 0');

  await wrapper.find('button').trigger('click');
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 1');
  expect(wrapper.emitted('increment')).toBeTruthy();
  expect(wrapper.emitted('increment')?.[0]).toEqual([1]);

  await wrapper.find('button').trigger('click');
  expect(wrapper.find('[data-testid="count"]').text()).toBe('Count: 2');
  expect(wrapper.emitted('increment')?.[1]).toEqual([2]);
});
