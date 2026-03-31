/**
 * WebSocket bridge server for webserial-flasher.
 *
 * This server enables any browser (Firefox, Safari, Chrome) to flash
 * Arduino / AVR firmware by proxying serial I/O through a local WebSocket.
 *
 * Architecture:
 *   Browser (WebSocketTransport) ←→ ws://localhost:7890 ←→ This server ←→ Serial port
 *
 * Protocol:
 *   Client → Server:  { type: 'write',   data: number[], seq: number }
 *                     { type: 'signals', dtr?: boolean, rts?: boolean, seq: number }
 *                     { type: 'break',   seq: number }
 *                     { type: 'close' }
 *   Server → Client:  { type: 'data',    data: number[] }
 *                     { type: 'ack',     seq: number }
 *                     { type: 'error',   seq: number, message: string }
 *
 * Usage:
 *   # Flash an Arduino Uno in the browser
 *   npx tsx examples/bridge/server.ts /dev/ttyACM0 115200
 *
 *   # Flash a UPDI device (8E2 parity)
 *   npx tsx examples/bridge/server.ts /dev/ttyUSB0 115200 --updi
 *
 * Then open examples/browser/websocket-flash.html in any browser.
 *
 * Requires: ws, serialport  (npm install ws serialport)
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { SerialPort } from 'serialport';
import { NodeSerialTransport } from 'webserial-flasher';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const portPath    = args[0];
const baudRate    = parseInt(args[1] ?? '115200', 10);
const isUpdi      = args.includes('--updi');
const wsPort      = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '7890', 10);

if (!portPath) {
  console.error('Usage: npx tsx server.ts <serial-port> [baud-rate] [--updi] [--port=7890]');
  console.error('  <serial-port>   e.g. /dev/ttyACM0 or COM3');
  console.error('  [baud-rate]     default: 115200');
  console.error('  [--updi]        open port at 8E2 for UPDI devices');
  console.error('  [--port=N]      WebSocket port (default: 7890)');
  process.exit(1);
}

// ── Serial port options ───────────────────────────────────────────────────────

const serialOptions = isUpdi
  ? { ...NodeSerialTransport.updiPortOptions(baudRate), path: portPath, autoOpen: false }
  : { path: portPath, baudRate, dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const, autoOpen: false };

// ── Start WebSocket server ────────────────────────────────────────────────────

const httpServer = createServer((_, res) => {
  res.writeHead(200);
  res.end('webserial-flasher bridge running');
});

const wss = new WebSocketServer({ server: httpServer });

console.log(`[bridge] Listening on ws://localhost:${wsPort}`);
console.log(`[bridge] Serial port : ${portPath} @ ${baudRate} baud${isUpdi ? ' (8E2/UPDI)' : ''}`);
console.log('[bridge] Waiting for browser connection …');

wss.on('connection', (ws) => {
  console.log('[bridge] Client connected');

  // Open a new serial port for each client connection
  const serial = new SerialPort(serialOptions as Parameters<typeof SerialPort>[0]);
  const transport = new NodeSerialTransport(serial);

  // Track whether this connection has been torn down to avoid sending on closed ws
  let connectionClosed = false;

  // Forward serial RX data → WebSocket client
  transport.on('data', (chunk) => {
    if (!connectionClosed && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: Array.from(chunk) }));
    }
  });

  // Helpers: guarded so they never write to a closed WebSocket
  const ack = (seq: number): void => {
    if (!connectionClosed && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ack', seq }));
    }
  };
  const sendError = (seq: number, message: string): void => {
    if (!connectionClosed && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', seq, message }));
    }
  };

  const teardown = (): void => {
    if (connectionClosed) return;
    connectionClosed = true;
    transport.close().catch(() => {});
  };

  // Open serial port when client connects
  serial.open((err) => {
    if (err) {
      console.error(`[bridge] Failed to open serial port: ${err.message}`);
      ws.close(1011, err.message);
      return;
    }
    console.log(`[bridge] Serial port opened: ${portPath}`);
  });

  // Validate and parse an incoming client message
  const parseMessage = (raw: Buffer): {
    type: string;
    seq?: number;
    data?: number[];
    dtr?: boolean;
    rts?: boolean;
  } | null => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (typeof msg['type'] !== 'string') return null;

    const seq = typeof msg['seq'] === 'number' ? msg['seq'] : undefined;

    if (msg['type'] === 'write') {
      if (!Array.isArray(msg['data'])) return null;
      const data = msg['data'] as unknown[];
      if (!data.every(x => typeof x === 'number' && x >= 0 && x <= 255)) return null;
      return { type: 'write', seq, data: data as number[] };
    }

    if (msg['type'] === 'signals') {
      return {
        type: 'signals',
        seq,
        dtr: typeof msg['dtr'] === 'boolean' ? msg['dtr'] : undefined,
        rts: typeof msg['rts'] === 'boolean' ? msg['rts'] : undefined,
      };
    }

    return { type: msg['type'] as string, seq };
  };

  // Handle messages from browser client
  ws.on('message', (raw) => {
    const msg = parseMessage(raw as Buffer);
    if (!msg) return;

    const { type, seq } = msg;

    switch (type) {
      case 'write': {
        const data = new Uint8Array(msg.data!);
        transport.write(data)
          .then(() => { if (seq !== undefined) ack(seq); })
          .catch((e: Error) => { if (seq !== undefined) sendError(seq, e.message); });
        break;
      }
      case 'signals': {
        if (transport.setSignals) {
          transport.setSignals({ dtr: msg.dtr, rts: msg.rts })
            .then(() => { if (seq !== undefined) ack(seq); })
            .catch((e: Error) => { if (seq !== undefined) sendError(seq, e.message); });
        } else if (seq !== undefined) {
          ack(seq); // no-op — signals not supported by this transport
        }
        break;
      }
      case 'break': {
        if (transport.sendBreak) {
          transport.sendBreak()
            .then(() => { if (seq !== undefined) ack(seq); })
            .catch((e: Error) => { if (seq !== undefined) sendError(seq, e.message); });
        } else if (seq !== undefined) {
          sendError(seq, 'sendBreak not supported by this transport');
        }
        break;
      }
      case 'close': {
        teardown();
        ws.close();
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[bridge] Client disconnected');
    teardown();
  });

  ws.on('error', (err) => {
    console.error('[bridge] WebSocket error:', err.message);
    teardown();
  });
});

httpServer.listen(wsPort);
