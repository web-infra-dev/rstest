/**
 * The one identity this document runs under.
 *
 * Written once at boot from the config handshake (headed: the container's
 * lease grant; headless: the host-injected inline options) and read by every
 * outbound channel — `send()` envelopes and dispatch requests alike. The
 * document never re-derives its identity from the URL: after an HMR full
 * reload the URL still names the run this frame was ORIGINALLY navigated for,
 * while the handshake names the run the container wants NOW — a rerun that
 * reports the URL's identity reports a dead run and deadlocks its cycle.
 */
let runId: string | undefined;

export const adoptRunIdentity = (value: string): void => {
  runId = value;
};

export const getRunIdentity = (): string | undefined => runId;
