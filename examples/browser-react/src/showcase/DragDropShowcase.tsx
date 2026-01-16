import { useState } from 'react';

type Card = {
  id: string;
  label: string;
};

const initialCards: Card[] = [
  { id: 'card-1', label: 'Design review' },
  { id: 'card-2', label: 'Code refactor' },
];

/**
 * Drag & Drop showcase component (Vercel Geist style).
 *
 * Demonstrates real browser capabilities that jsdom cannot replicate:
 * - Native HTML5 drag and drop with DataTransfer
 * - Visual drag feedback (ghost image, drop zone highlighting)
 * - Real pointer events during drag operations
 */
export function DragDropShowcase() {
  const [inbox, setInbox] = useState<Card[]>(initialCards);
  const [done, setDone] = useState<Card[]>([]);
  const [dragOver, setDragOver] = useState<'inbox' | 'done' | null>(null);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    card: Card,
    from: 'inbox' | 'done',
  ) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ card, from }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    to: 'inbox' | 'done',
  ) => {
    e.preventDefault();
    setDragOver(null);

    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;

    const { card, from } = JSON.parse(data) as { card: Card; from: string };
    if (from === to) return;

    if (from === 'inbox' && to === 'done') {
      setInbox((prev) => prev.filter((c) => c.id !== card.id));
      setDone((prev) => [...prev, card]);
    } else if (from === 'done' && to === 'inbox') {
      setDone((prev) => prev.filter((c) => c.id !== card.id));
      setInbox((prev) => [...prev, card]);
    }
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    zone: 'inbox' | 'done',
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(zone);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const zoneStyle = (zone: 'inbox' | 'done'): React.CSSProperties => ({
    flex: 1,
    padding: 16,
    borderRadius: 10,
    background: dragOver === zone ? '#fafafa' : '#fff',
    border: `2px dashed ${dragOver === zone ? '#000' : '#d0d0d0'}`,
    transition: 'all 150ms ease',
    minHeight: 180,
  });

  const cardStyle: React.CSSProperties = {
    padding: '12px 14px',
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #d0d0d0',
    marginBottom: 10,
    cursor: 'grab',
    fontSize: 15,
    fontWeight: 400,
    color: '#000',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: '#444',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

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
          maxWidth: 600,
        }}
      >
        {/* Header */}
        <h2
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: '#000',
            marginBottom: 16,
            marginTop: 0,
          }}
        >
          Drag & Drop
        </h2>

        {/* Zones container */}
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Inbox */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag demo */}
          <div
            data-testid="drop-zone-inbox"
            onDrop={(e) => handleDrop(e, 'inbox')}
            onDragOver={(e) => handleDragOver(e, 'inbox')}
            onDragLeave={handleDragLeave}
            style={zoneStyle('inbox')}
          >
            <div style={labelStyle}>Todo ({inbox.length})</div>
            {inbox.map((card) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: drag demo
              <div
                key={card.id}
                data-testid={`card-${card.id}`}
                draggable
                onDragStart={(e) => handleDragStart(e, card, 'inbox')}
                style={cardStyle}
              >
                {card.label}
              </div>
            ))}
            {inbox.length === 0 && (
              <div style={{ color: '#888', fontSize: 14 }}>Drop here</div>
            )}
          </div>

          {/* Done */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag demo */}
          <div
            data-testid="drop-zone-done"
            onDrop={(e) => handleDrop(e, 'done')}
            onDragOver={(e) => handleDragOver(e, 'done')}
            onDragLeave={handleDragLeave}
            style={zoneStyle('done')}
          >
            <div style={labelStyle}>Done ({done.length})</div>
            {done.map((card) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: drag demo
              <div
                key={card.id}
                data-testid={`card-${card.id}`}
                draggable
                onDragStart={(e) => handleDragStart(e, card, 'done')}
                style={cardStyle}
              >
                {card.label}
              </div>
            ))}
            {done.length === 0 && (
              <div style={{ color: '#888', fontSize: 14 }}>Drop here</div>
            )}
          </div>
        </div>

        {/* Helper text */}
        <p
          style={{
            marginTop: 16,
            fontSize: 14,
            color: '#666',
            lineHeight: 1.6,
          }}
        >
          Native HTML5 Drag & Drop with DataTransfer API — features jsdom cannot
          replicate.
        </p>
      </div>
    </div>
  );
}
