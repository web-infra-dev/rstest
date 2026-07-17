import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: {
    name: 'jsdom',
    options: {
      html: `<script>
        window.addEventListener(
          'error',
          event => queueMicrotask(() => {
            event.preventDefault();
            Object.defineProperty(event, 'error', { value: null });
          }),
          { once: true },
        );
      </script>`,
    },
  },
});
