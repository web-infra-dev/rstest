import { expect, test } from '@rstest/core';
import { mount } from '@vue/test-utils';
import App from '../src/App.vue';

test('should emit clickApp event when button is clicked', async () => {
  const wrapper = mount(App, {});
  await wrapper.find('button').trigger('click');
  expect(wrapper.emitted('clickApp')).toBeTruthy();
});
