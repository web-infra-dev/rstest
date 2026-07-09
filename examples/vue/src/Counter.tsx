import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'CounterJsx',

  props: {
    initialCount: {
      type: Number,
      default: 0,
    },
  },

  emits: ['increment'],

  setup(props, { emit }) {
    const count = ref(props.initialCount);

    const increment = () => {
      count.value++;
      emit('increment', count.value);
    };

    return () => (
      <div>
        <span data-testid="count">Count: {count.value}</span>
        <button type="button" onClick={increment}>
          Increment
        </button>
      </div>
    );
  },
});
