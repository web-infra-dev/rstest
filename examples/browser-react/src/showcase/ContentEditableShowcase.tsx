import { useState } from 'react';

/**
 * Text input showcase component (Vercel Geist style).
 *
 * Demonstrates real browser capabilities that jsdom cannot replicate:
 * - Native caret/cursor rendering
 * - Text selection highlighting
 * - Real-time input with visible typing
 */
export function ContentEditableShowcase() {
  const [text, setText] = useState('Click to edit this text');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '80px 48px',
        fontFamily:
          'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#fff',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
        }}
      >
        {/* Label */}
        <label
          htmlFor="demo-input"
          style={{
            display: 'block',
            fontSize: 15,
            fontWeight: 500,
            color: '#000',
            marginBottom: 10,
          }}
        >
          Live Input
        </label>

        {/* Input */}
        <input
          id="demo-input"
          type="text"
          data-testid="editable-title"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 16,
            fontWeight: 400,
            color: '#000',
            padding: '12px 14px',
            border: '1px solid #d0d0d0',
            borderRadius: 8,
            outline: 'none',
            background: '#fff',
            transition: 'border-color 150ms ease, box-shadow 150ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#000';
            e.currentTarget.style.boxShadow = '0 0 0 1px #000';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#d0d0d0';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />

        {/* Helper text */}
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            color: '#666',
            lineHeight: 1.6,
          }}
        >
          Native caret, selection highlighting, and IME input — features jsdom
          cannot replicate.
        </p>
      </div>
    </div>
  );
}
