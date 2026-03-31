/**
 * Example: Flash Arduino Uno via Node.js + serialport package
 *
 * Install: npm install serialport
 * Run:     tsx examples/node/uno.ts /dev/ttyACM0 firmware.hex
 */

import fs from 'fs/promises';
import { SerialPort } from 'serialport';
import STK500, { NodeSerialTransport, BOARDS } from '../../src/index.js';

const [,, portPath, hexFile] = process.argv;

if (!portPath || !hexFile) {
  console.error('Usage: tsx uno.ts <port> <hex-file>');
  console.error('Example: tsx uno.ts /dev/ttyACM0 firmware.hex');
  process.exit(1);
}

async function main(): Promise<void> {
  const board = BOARDS['arduino-uno'];
  let transport: NodeSerialTransport | null = null;

  try {
    const hex = await fs.readFile(hexFile);

    // Open the serial port
    const port = new SerialPort({ path: portPath, baudRate: board.baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) => {
      port.open((err) => err ? reject(err) : resolve());
    });

    transport = new NodeSerialTransport(port);

    const stk = new STK500(transport, board, {
      logger: (level, msg) => console.log(`[${level}] ${msg}`),
    });

    await stk.bootload(hex, (status, pct) => {
      process.stdout.write(`\r  ${status.padEnd(35)} ${Math.round(pct).toString().padStart(3)}%`);
    });

    console.log('\nDone! Arduino is running the new firmware.');

  } catch (err) {
    console.error('\nFlash failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await transport?.close();
  }
}

main().catch(console.error);
