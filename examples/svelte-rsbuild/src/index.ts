import { mount } from 'svelte';
import Counter from './components/Counter.svelte';

const target =
  document.getElementById('root') ??
  document.body.appendChild(document.createElement('div'));

target.id = 'root';

export default mount(Counter, {
  target,
  props: {
    initialValue: 1,
  },
});
