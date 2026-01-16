import React, { useEffect, useRef, useState } from 'react';

const checklistItems = [
  'Run smoke suite',
  'Verify changelog copy',
  'Publish release notes',
];

export function ReleaseChecklist() {
  const [isAuditNoteVisible, setIsAuditNoteVisible] = useState(false);
  const revealTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== undefined) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  const scheduleAuditNote = () => {
    if (revealTimerRef.current !== undefined) {
      window.clearTimeout(revealTimerRef.current);
    }

    revealTimerRef.current = window.setTimeout(() => {
      setIsAuditNoteVisible(true);
      revealTimerRef.current = undefined;
    }, 150);
  };

  const hideAuditNote = () => {
    if (revealTimerRef.current !== undefined) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = undefined;
    }

    setIsAuditNoteVisible(false);
  };

  return (
    <section
      aria-label="Release checklist"
      id="release-checklist"
      style={{
        border: '2px solid #1d4ed8',
        borderRadius: '12px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        maxWidth: '720px',
        padding: '20px',
      }}
    >
      <h1 style={{ margin: '0 0 10px' }}>Release checklist</h1>

      <p id="release-owner" style={{ margin: '0 0 8px' }}>
        Owner: Platform QA
      </p>

      <p id="release-summary" style={{ margin: '0 0 12px' }}>
        3 checks pending
      </p>

      <button
        id="show-audit-note"
        onMouseEnter={scheduleAuditNote}
        onMouseLeave={hideAuditNote}
        style={{ marginBottom: '12px', padding: '10px 14px' }}
        type="button"
      >
        Show audit note
      </button>

      <div
        id="audit-note"
        style={{
          background: '#dbeafe',
          borderRadius: '8px',
          display: isAuditNoteVisible ? 'block' : 'none',
          marginBottom: '12px',
          padding: '10px 12px',
        }}
      >
        Audit note: cache warm and smoke checks ready.
      </div>

      <ol id="release-items" style={{ paddingLeft: '22px' }}>
        {checklistItems.map((item) => {
          return (
            <li key={item} style={{ marginBottom: '6px' }}>
              {item}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
