import { createJSONRPCErrorResponse, JSONRPCClient } from 'json-rpc-2.0';
import WebSocket from 'ws';
import type { CdpClient, EvaluatedValue } from './types';

const REQUEST_TIMEOUT_MS = 60_000;

// ============================================================================
// CDP Client
// ============================================================================

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * CDP protocol doesn't use JSON-RPC 2.0's `jsonrpc` field.
 * Strip it to avoid protocol errors.
 */
const stripJsonRpcField = (payload: unknown): unknown => {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripJsonRpcField(item));
  }
  if (!isObject(payload) || !('jsonrpc' in payload)) return payload;
  const { jsonrpc: _, ...rest } = payload;
  return rest;
};

export const createCdpClient = async (wsUrl: string): Promise<CdpClient> => {
  const socket = new WebSocket(wsUrl);

  const client = new JSONRPCClient<void>((payload) => {
    const raw = JSON.stringify(stripJsonRpcField(payload));
    return new Promise<void>((resolve, reject) => {
      socket.send(raw, (error) => (error ? reject(error) : resolve()));
    });
  });

  const requester = client.timeout(REQUEST_TIMEOUT_MS, (id) =>
    createJSONRPCErrorResponse(id, -32000, 'CDP request timed out.'),
  );

  const listeners = new Map<string, (params: unknown) => void>();

  socket.on('message', (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      client.rejectAllPendingRequests(
        `Invalid CDP message: ${error instanceof Error ? error.message : String(error)}`,
      );
      socket.close();
      return;
    }
    if (!isObject(message)) return;

    // Response to a request
    if ('id' in message) {
      client.receive(
        message as unknown as Parameters<typeof client.receive>[0],
      );
      return;
    }

    // Event notification
    const method = message.method;
    if (typeof method === 'string') {
      listeners.get(method)?.(message.params);
    }
  });

  socket.on('error', (error) => {
    client.rejectAllPendingRequests(
      error instanceof Error ? error.message : String(error),
    );
  });

  socket.on('close', () => {
    client.rejectAllPendingRequests('CDP websocket closed.');
  });

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (err) => reject(err));
  });

  return {
    send: (method, params = {}) =>
      Promise.resolve(requester.request(method, params, undefined)),
    on: (method, handler) =>
      listeners.set(method, handler as (params: unknown) => void),
    close: () => {
      client.rejectAllPendingRequests('CDP client closed.');
      socket.close();
    },
  };
};

// ============================================================================
// Expression Evaluation
// ============================================================================

type RemoteObject = {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
};

type PropertyDescriptor = {
  name?: string;
  value?: RemoteObject;
};

/**
 * Evaluate expressions on a paused call frame.
 * For objects, fetches shallow properties to provide useful debug output.
 */
export const evaluateExpressions = async ({
  cdp,
  callFrameId,
  expressions,
}: {
  cdp: CdpClient;
  callFrameId: string;
  expressions: string[];
}): Promise<EvaluatedValue[]> => {
  return Promise.all(
    expressions.map(async (expression) => {
      const result = await cdp.send<{ result?: RemoteObject }>(
        'Debugger.evaluateOnCallFrame',
        { callFrameId, expression },
      );
      const payload = result?.result;
      let value = payload?.value;
      const type = payload?.type;
      const subtype = payload?.subtype;
      const preview = payload?.description;

      // For objects without a primitive value, fetch shallow properties
      if (value === undefined && payload?.objectId) {
        try {
          const properties = await cdp.send<{ result?: PropertyDescriptor[] }>(
            'Runtime.getProperties',
            { objectId: payload.objectId, ownProperties: true },
          );
          const shallow: Record<string, unknown> = {};
          for (const prop of properties?.result || []) {
            if (!prop?.name || prop?.value == null) continue;
            const propVal = prop.value;
            shallow[prop.name] =
              propVal.value ?? propVal.description ?? propVal.type;
          }
          value = shallow;
        } catch {
          value = preview;
        }
      }

      return {
        expression,
        value,
        type,
        subtype,
        preview,
      } satisfies EvaluatedValue;
    }),
  );
};
