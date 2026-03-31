/**
 * Browser firmware flashing via WebSocket bridge — works in Firefox, Safari, Chrome.
 *
 * Unlike WebSerialTransport (Chrome/Edge only), WebSocketTransport routes all
 * serial I/O through a local bridge server, enabling any browser to flash firmware.
 *
 * Prerequisites:
 *   1. Run the bridge server:
 *      npx tsx examples/bridge/server.ts /dev/ttyACM0 115200
 *
 *   2. Include this script in your HTML or bundle it.
 *
 * Usage (import from CDN or local build):
 *   import { STK500, WebSocketTransport, BOARDS } from 'webserial-flasher';
 */

import { STK500, UPDI, WebSocketTransport, BOARDS } from 'webserial-flasher';

// ── Example 1: Flash Arduino Uno via bridge ───────────────────────────────────

export async function flashUnoViaBridge(
  hexData: string,
  bridgeUrl = 'ws://localhost:7890',
  onProgress?: (status: string, pct: number) => void,
): Promise<void> {
  const board = BOARDS['arduino-uno'];
  if (!board) throw new Error('arduino-uno not found in board database');

  // Connect to local bridge server — works in any browser
  const transport = await WebSocketTransport.connect(bridgeUrl, {
    connectTimeoutMs: 5000,
    ackTimeoutMs:     10000,
  });

  try {
    const stk = new STK500(transport, board);
    await stk.bootload(hexData, onProgress);
  } finally {
    await transport.close();
  }
}

// ── Example 2: Flash ATtiny (UPDI) via bridge ─────────────────────────────────

export async function flashAttinyViaBridge(
  hexData: string,
  boardId = 'attiny416',
  bridgeUrl = 'ws://localhost:7890',
  onProgress?: (status: string, pct: number) => void,
): Promise<void> {
  const board = BOARDS[boardId];
  if (!board) throw new Error(`Unknown board: ${boardId}`);

  // Bridge server must be started with --updi flag:
  //   npx tsx examples/bridge/server.ts /dev/ttyUSB0 115200 --updi
  const transport = await WebSocketTransport.connect(bridgeUrl);

  try {
    const updi = new UPDI(transport, board);
    await updi.bootload(hexData, onProgress);
  } finally {
    await transport.close();
  }
}

// ── Example 3: Minimal inline usage ──────────────────────────────────────────
//
// document.getElementById('flash-btn')?.addEventListener('click', async () => {
//   const hex = await fetch('/firmware/blink.hex').then(r => r.text());
//   const progressBar = document.getElementById('progress');
//
//   await flashUnoViaBridge(hex, 'ws://localhost:7890', (status, pct) => {
//     if (progressBar) progressBar.style.width = `${pct}%`;
//     console.log(`[${pct}%] ${status}`);
//   });
//
//   alert('Flash complete!');
// });
