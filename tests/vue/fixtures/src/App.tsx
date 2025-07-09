import { defineComponent } from 'vue';

export default defineComponent({
  name: 'App',

  setup(_props, { emit }) {
    const onClickApp = (event: any) => emit('clickApp', event);

    return () => (
      <div class="content">
        <h1>Rsbuild with Vue</h1>
        <p>Start building amazing things with Rsbuild.</p>
        <button type="button" onClick={onClickApp}>
          click me
        </button>
      </div>
    );
  },
});
