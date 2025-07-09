import { expect, test } from '@rstest/core';
import { mount } from '@vue/test-utils';
import App from '../src/App.jsx';

test('should emit clickApp event when button is clicked', async () => {
  const wrapper = mount(App, {});
  wrapper.find('button').trigger('click');
  expect(wrapper.emitted('clickApp')).toBeTruthy();
});
