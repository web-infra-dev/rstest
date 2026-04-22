import { useCallback, useEffect, useState } from 'react';
import styles from './AgentPrompt.module.scss';

type Variant = 'install' | 'migrate';

const PROMPTS: Record<Variant, string> = {
  install:
    'Set up Rstest in this project by following the instructions here:\nhttps://rstest.rs/guide/start/agent-install.md',
  migrate:
    'Migrate this project to Rstest by following the instructions here:\nhttps://rstest.rs/guide/start/agent-migrate.md',
};

/**
 * SVG icons sourced from @lobehub/icons (MIT license).
 */
const ICONS: { color: string; name: string; svg: React.ReactNode }[] = [
  {
    name: 'Robot',
    color: '#22C55E',
    svg: <span style={{ fontSize: 18, lineHeight: 1 }}>🤖</span>,
  },
  {
    name: 'Claude Code',
    color: '#D97757',
    svg: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          clipRule="evenodd"
          d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
          fill="#D97757"
          fillRule="evenodd"
        />
      </svg>
    ),
  },
  {
    name: 'Cursor',
    color: '#434343',
    svg: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    name: 'Amp',
    color: '#F34E3F',
    svg: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M15.087 23.18L12.03 24l-2.097-7.823-5.738 5.738-2.251-2.251 5.718-5.719-7.769-2.082.82-3.057 11.294 3.08 3.08 11.295z"
          fill="#F34E3F"
        />
        <path
          d="M19.505 18.762l-3.057.82-2.564-9.573-9.572-2.564.819-3.057 11.295 3.079 3.08 11.295z"
          fill="#F34E3F"
        />
        <path
          d="M23.893 14.374l-3.057.82-2.565-9.572L8.7 3.057 9.52 0l11.295 3.08 3.079 11.294z"
          fill="#F34E3F"
        />
      </svg>
    ),
  },
  {
    name: 'Codex',
    color: '#6366F1',
    svg: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z"
          fill="#fff"
        />
        <path
          d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
          fill="#6366F1"
        />
      </svg>
    ),
  },
  {
    name: 'opencode',
    color: '#6B7280',
    svg: (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" fill="currentColor" />
      </svg>
    ),
  },
];

const INTERVAL = 10000;

function RotatingIcon({ index, fading }: { index: number; fading: boolean }) {
  return (
    <span
      className={`${styles.icon} ${fading ? styles.iconFadeOut : styles.iconFadeIn}`}
      title={ICONS[index].name}
    >
      {ICONS[index].svg}
    </span>
  );
}

export function AgentPrompt({ variant = 'install' }: { variant?: Variant }) {
  const promptText = PROMPTS[variant];

  if (import.meta.env.SSG_MD) {
    return <>{`\`\`\`\n${promptText}\n\`\`\`\n`}</>;
  }

  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % ICONS.length);
        setFading(false);
      }, 200);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(promptText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [promptText]);

  const headerBg = `${ICONS[index].color}12`;

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.header}
        style={{
          backgroundColor: headerBg,
          transition: 'background-color 0.3s ease',
        }}
      >
        <span className={styles.label}>
          <RotatingIcon index={index} fading={fading} />
          Agent Prompt
        </span>
        <button type="button" className={styles.copyBtn} onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className={styles.body}>{promptText}</div>
    </div>
  );
}
