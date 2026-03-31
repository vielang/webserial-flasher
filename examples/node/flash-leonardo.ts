/**
 * Flash an Arduino Leonardo / Micro / Pro Micro (ATmega32U4)
 * using AVR109 / Caterina protocol over Node.js.
 *
 * These boards need a CDC 1200-baud reset trick to enter bootloader mode.
 * The port may re-enumerate to a different path after reset.
 *
 * Usage:
 *   npx tsx examples/node/flash-leonardo.ts /dev/ttyACM0 firmware.hex
 *
 * Windows:
 *   npx tsx examples/node/flash-leonardo.ts COM3 firmware.hex
 */

import fs from 'fs/promises';
import { SerialPort } from 'serialport';
import { AVR109, NodeSerialTransport, BOARDS } from 'webserial-flasher';

const board = BOARDS['arduino-leonardo']!;

/** Trigger bootloader entry by opening at 1200 baud then closing */
async function triggerBootloader(port: string): Promise<void> {
  console.log('Triggering bootloader (1200-baud reset)…');
  await new Promise<void>((resolve, reject) => {
    const sp = new SerialPort({ path: port, baudRate: 1200, autoOpen: true });
    sp.on('open', () => {
      setTimeout(() => sp.close((err) => (err ? reject(err) : resolve())), 300);
    });
    sp.on('error', reject);
  });
  // Wait for the board to re-enumerate as a new CDC port
  console.log('Waiting for re-enumeration…');
  await new Promise((res) => setTimeout(res, board.cdcResetWaitMs ?? 3000));
}

async function main() {
  const [, , port, hexFile] = process.argv;

  if (!port || !hexFile) {
    console.error('Usage: npx tsx flash-leonardo.ts <port> <firmware.hex>');
    console.error('Note: the port path may change after bootloader entry.');
    process.exit(1);
  }

  console.log(`Board : ${board.name}`);
  console.log(`Port  : ${port}`);
  console.log(`File  : ${hexFile}`);
  console.log('');

  const hex = await fs.readFile(hexFile, 'utf8');

  await triggerBootloader(port);

  // Re-open at the bootloader baud rate (57600)
  const serialPort = new SerialPort({ path: port, baudRate: board.baudRate, autoOpen: false });
  const transport  = new NodeSerialTransport(serialPort);
  const avr        = new AVR109(transport, board);

  try {
    await avr.bootload(hex, (status, pct) => {
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
