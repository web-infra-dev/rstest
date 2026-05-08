<script lang="ts">
import { getDefaultStep } from '@/utils/step';

export let initialValue = 0;
export let step = getDefaultStep();

let count = initialValue;

function decrement() {
  count -= step;
}

function increment() {
  count += step;
}

function reset() {
  count = initialValue;
}
</script>

<div data-testid="counter">
  <button type="button" on:click={decrement} data-testid="decrement-btn">-</button>
  <span data-testid="counter-value">{count}</span>
  <button type="button" on:click={increment} data-testid="increment-btn">+</button>
  <button type="button" on:click={reset} data-testid="reset-btn">Reset</button>
</div>
