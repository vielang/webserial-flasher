/**
 * Flash an ATtiny416 / ATtiny816 / ATtiny1616 / ATmega4809 using UPDI protocol.
 *
 * UPDI requires a single-wire serial adapter connected to the UPDI pin.
 * A common DIY adapter uses a 4.7kΩ resistor between TX and RX pins of
 * a USB-UART adapter (SerialUPDI), or you can use a dedicated UPDI programmer.
 *
 * Wiring (SerialUPDI):
 *   USB-UART TX ──┬── 4.7kΩ ──── UPDI pin
 *   USB-UART RX ──┘              (target board)
 *                                GND → GND
 *                                VCC → VCC (3.3V or 5V depending on chip)
 *
 * Usage:
 *   npx tsx examples/node/flash-attiny.ts /dev/ttyUSB0 firmware.hex [board]
 *
 * Supported board IDs: attiny416, attiny816, attiny1614, attiny1616, attiny3216,
 *                      attiny3217, atmega4809-updi, atmega4808-updi
 */

import fs from 'fs/promises';
import { SerialPort } from 'serialport';
import { UPDI, NodeSerialTransport, BOARDS } from 'webserial-flasher';

async function main() {
  const [, , port, hexFile, boardId = 'attiny416'] = process.argv;

  if (!port || !hexFile) {
    console.error('Usage: npx tsx flash-attiny.ts <port> <firmware.hex> [boardId]');
    console.error('  boardId defaults to "attiny416"');
    console.error('  Available: attiny416, attiny816, attiny1616, atmega4809-updi, …');
    process.exit(1);
  }

  const board = BOARDS[boardId];
  if (!board) {
    console.error(`Unknown board: "${boardId}"`);
    console.error('Available UPDI boards:', Object.keys(BOARDS).filter(k => BOARDS[k]!.protocol === 'updi').join(', '));
    process.exit(1);
  }

  console.log(`Board : ${board.name}`);
  console.log(`Port  : ${port}`);
  console.log(`File  : ${hexFile}`);
  console.log('');

  const hex = await fs.readFile(hexFile, 'utf8');

  // UPDI uses 115200 8E2 (even parity, 2 stop bits)
  const serialPort = new SerialPort({
    path:     port,
    baudRate: board.baudRate,
    dataBits: 8,
    parity:   'even',
    stopBits: 2,
    autoOpen: false,
  });
  const transport = new NodeSerialTransport(serialPort);
  const updi      = new UPDI(transport, board);

  try {
    await updi.bootload(hex, (status, pct) => {
      process.stdout.write(`\r[${String(pct).padStart(3)}%] ${status}          `);
    });
    console.log('\n✓ Flash complete!');
  } finally {
    await transport.close();
  }
}

main().catch((err) => {
  console.error('\n✗ Flash failed:', err.message);
  process.exit(1);
});
