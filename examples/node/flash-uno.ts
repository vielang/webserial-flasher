/**
 * Flash an Arduino Uno (ATmega328P) using STK500v1 protocol over Node.js.
 *
 * Usage:
 *   npx tsx examples/node/flash-uno.ts /dev/ttyACM0 firmware.hex
 *
 * Windows:
 *   npx tsx examples/node/flash-uno.ts COM3 firmware.hex
 */

import fs from 'fs/promises';
import { SerialPort } from 'serialport';
import { STK500, NodeSerialTransport, BOARDS } from 'webserial-flasher';

const board = BOARDS['arduino-uno']!;

async function main() {
  const [, , port, hexFile] = process.argv;

  if (!port || !hexFile) {
    console.error('Usage: npx tsx flash-uno.ts <port> <firmware.hex>');
    console.error('  port     Serial port (e.g. /dev/ttyACM0 or COM3)');
    console.error('  firmware Path to compiled .hex file');
    process.exit(1);
  }

  console.log(`Board : ${board.name}`);
  console.log(`Port  : ${port}`);
  console.log(`File  : ${hexFile}`);
  console.log('');

  const hex = await fs.readFile(hexFile, 'utf8');

  const serialPort = new SerialPort({ path: port, baudRate: board.baudRate, autoOpen: false });
  const transport  = new NodeSerialTransport(serialPort);

  const stk = new STK500(transport, board);

  try {
    await stk.bootload(hex, (status, pct) => {
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
