import { useState } from 'react';
import './Counter.css';

interface CounterProps {
  initialCount?: number;
  min?: number;
  max?: number;
}

export function Counter({ initialCount = 0, min = 0, max = 5 }: CounterProps) {
  const [count, setCount] = useState(initialCount);
  const [size, setSize] = useState('M');
  const [message, setMessage] = useState('');

  const canDecrement = count > min;
  const canIncrement = count < max;
  const canAddToCart = count > 0;

  const increment = () => {
    setCount((current) => {
      return current < max ? current + 1 : current;
    });
  };

  const decrement = () => {
    setCount((current) => {
      return current > min ? current - 1 : current;
    });
  };

  const addToCart = () => {
    setMessage(`Added ${count} item(s), size ${size}`);
  };

  return (
    <section className="product-card" aria-label="Product card">
      <p className="product-badge">Component library demo</p>
      <h2 className="product-title">Soft Hoodie</h2>

      <label htmlFor="size-select">Size</label>
      <select
        id="size-select"
        className="control-select"
        value={size}
        onChange={(event) => setSize(event.target.value)}
      >
        <option value="S">S</option>
        <option value="M">M</option>
        <option value="L">L</option>
      </select>

      <fieldset className="control-row">
        <legend>Quantity controls</legend>
        <button
          type="button"
          className="count-btn"
          disabled={!canDecrement}
          onClick={decrement}
        >
          Decrease
        </button>
        <output aria-label="count">{count}</output>
        <button
          type="button"
          className="count-btn"
          disabled={!canIncrement}
          onClick={increment}
        >
          Increase
        </button>
      </fieldset>

      <output aria-label="Selected quantity" aria-live="polite">
        Selected quantity: {count}
      </output>

      <button
        type="button"
        className="primary-btn"
        disabled={!canAddToCart}
        onClick={addToCart}
      >
        Add to cart
      </button>

      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
