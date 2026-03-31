// WebSocket bridge transport for webserial-flasher.
// Enables firmware flashing from any browser (Firefox, Safari, Chrome) by
// proxying serial I/O through a local WebSocket bridge server.
//
// The bridge server listens on a local port, opens the actual serial port,
// and forwards bytes between the WebSocket client and the serial device.
//
// Message protocol (JSON over WebSocket):
//   Client → Server:
//     { type: 'write',   data: number[], seq: number }
//     { type: 'signals', dtr?: boolean, rts?: boolean, seq: number }
//     { type: 'break',   seq: number }
//     { type: 'close' }
//   Server → Client:
//     { type: 'data',  data: number[] }
//     { type: 'ack',   seq: number }
//     { type: 'error', seq: number, message: string }
//
// Usage:
//   const transport = await WebSocketTransport.connect('ws://localhost:7890');
//   const stk = new STK500(transport, board);
//   await stk.bootload(hex);
//   await transport.close();
//
// Companion bridge server: see examples/bridge/server.ts

import type { ISTKTransport, SerialSignals } from './ITransport.js';

// ── Message types ─────────────────────────────────────────────────────────────

type ClientWriteMsg   = { type: 'write';   data: number[]; seq: number };
type ClientSignalsMsg = { type: 'signals'; dtr?: boolean; rts?: boolean; seq: number };
type ClientBreakMsg   = { type: 'break';   seq: number };
type ClientCloseMsg   = { type: 'close' };
type ClientMessage    = ClientWriteMsg | ClientSignalsMsg | ClientBreakMsg | ClientCloseMsg;

type ServerDataMsg  = { type: 'data';  data: number[] };
type ServerAckMsg   = { type: 'ack';   seq: number };
type ServerErrorMsg = { type: 'error'; seq: number; message: string };
type ServerMessage  = ServerDataMsg | ServerAckMsg | ServerErrorMsg;

export interface WebSocketTransportOptions {
  /**
   * Timeout (ms) waiting for the server to acknowledge a write/signal/break.
   * Default: 5000
   */
  ackTimeoutMs?: number;
  /**
   * Timeout (ms) waiting for the WebSocket connection to open.
   * Default: 3000
   */
  connectTimeoutMs?: number;
}

export class WebSocketTransport implements ISTKTransport {
  private readonly listeners = new Set<(chunk: Uint8Array) => void>();
  private seq = 0;
  private readonly pendingAcks = new Map<number, {
    resolve: () => void;
    reject:  (err: Error) => void;
  }>();
  private readonly ackTimeoutMs: number;
  private closed = false;

  private constructor(
    private readonly ws: WebSocket,
    ackTimeoutMs: number
  ) {
    this.ackTimeoutMs = ackTimeoutMs;
    this.ws.onmessage = (event: MessageEvent) => this.onMessage(event);
    this.ws.onerror = () => this.rejectAllPending(new Error('WebSocketTransport: connection error'));
    this.ws.onclose = () => this.rejectAllPending(new Error('WebSocketTransport: connection closed unexpectedly'));
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /**
   * Connect to a WebSocket bridge server and return a ready transport.
   *
   * @param url             WebSocket URL — e.g. 'ws://localhost:7890'
   * @param options         Optional timeout configuration
   */
  static connect(
    url: string,
    options: WebSocketTransportOptions = {}
  ): Promise<WebSocketTransport> {
    const connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    const ackTimeoutMs     = options.ackTimeoutMs     ?? 5000;

    return new Promise<WebSocketTransport>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error(
          `WebSocketTransport: connection to "${url}" timed out after ${connectTimeoutMs} ms. ` +
          'Is the bridge server running?'
        ));
      }, connectTimeoutMs);

      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new WebSocketTransport(ws, ackTimeoutMs));
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(
          `WebSocketTransport: failed to connect to "${url}". ` +
          'Is the bridge server running?'
        ));
      };

      ws.onclose = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocketTransport: connection to "${url}" was closed before opening.`));
      };
    });
  }

  /** Returns true if running in an environment that has WebSocket support. */
  static isSupported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  // ── ISTKTransport implementation ──────────────────────────────────────────

  async write(data: Uint8Array): Promise<void> {
    const msg: ClientWriteMsg = {
      type: 'write',
      data: Array.from(data),
      seq:  this.nextSeq(),
    };
    return this.sendAndAwaitAck(msg);
  }

  on(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    this.listeners.add(handler);
  }

  off(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    this.listeners.delete(handler);
  }

  async setSignals(opts: SerialSignals): Promise<void> {
    const msg: ClientSignalsMsg = {
      type: 'signals',
      dtr:  opts.dtr,
      rts:  opts.rts,
      seq:  this.nextSeq(),
    };
    return this.sendAndAwaitAck(msg);
  }

  async sendBreak(): Promise<void> {
    const msg: ClientBreakMsg = { type: 'break', seq: this.nextSeq() };
    return this.sendAndAwaitAck(msg);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(new Error('WebSocketTransport: transport closed'));
    this.listeners.clear();

    // Remove event handlers to prevent post-close callbacks
    this.ws.onmessage = null;
    this.ws.onerror   = null;
    this.ws.onclose   = null;

    const closeMsg: ClientCloseMsg = { type: 'close' };
    try { this.ws.send(JSON.stringify(closeMsg)); } catch { /* best-effort */ }
    this.ws.close();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private rejectAllPending(err: Error): void {
    if (this.pendingAcks.size === 0) return;
    for (const [, pending] of this.pendingAcks) {
      pending.reject(err);
    }
    this.pendingAcks.clear();
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  private sendAndAwaitAck(msg: ClientMessage & { seq: number }): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('WebSocketTransport: transport is closed'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(msg.seq);
        reject(new Error(
          `WebSocketTransport: bridge server did not ack "${msg.type}" ` +
          `(seq=${msg.seq}) within ${this.ackTimeoutMs} ms`
        ));
      }, this.ackTimeoutMs);

      this.pendingAcks.set(msg.seq, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject:  (err) => { clearTimeout(timer); reject(err); },
      });

      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        this.pendingAcks.delete(msg.seq);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private onMessage(event: MessageEvent): void {
    if (this.closed) return;

    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return; // ignore malformed messages
    }

    switch (msg.type) {
      case 'data': {
        const chunk = new Uint8Array(msg.data);
        this.listeners.forEach((fn) => fn(chunk));
        break;
      }
      case 'ack': {
        const pending = this.pendingAcks.get(msg.seq);
        if (pending) {
          this.pendingAcks.delete(msg.seq);
          pending.resolve();
        }
        break;
      }
      case 'error': {
        const pending = this.pendingAcks.get(msg.seq);
        if (pending) {
          this.pendingAcks.delete(msg.seq);
          pending.reject(new Error(`Bridge error: ${msg.message}`));
        }
        break;
      }
    }
  }
}
