/**
 * Auto-detect the protocol and board from a connected Arduino,
 * then flash it automatically — no need to specify the board type.
 *
 * Supports: STK500v1, STK500v2, AVR109 (Leonardo/Micro)
 * Note: UPDI and PICOBOOT cannot be auto-detected.
 *
 * Usage:
 *   npx tsx examples/node/auto-detect.ts /dev/ttyACM0 firmware.hex
 *
 * Windows:
 *   npx tsx examples/node/auto-detect.ts COM3 firmware.hex
 */

import fs from 'fs/promises';
import { SerialPort } from 'serialport';
import {
  autoDetect,
  STK500,
  STK500v2,
  AVR109,
  NodeSerialTransport,
} from 'webserial-flasher';

async function main() {
  const [, , port, hexFile] = process.argv;

  if (!port || !hexFile) {
    console.error('Usage: npx tsx auto-detect.ts <port> <firmware.hex>');
    process.exit(1);
  }

  console.log(`Port  : ${port}`);
  console.log(`File  : ${hexFile}`);
  console.log('');
  console.log('Auto-detecting board…');

  const hex = await fs.readFile(hexFile, 'utf8');

  // Build a transport for detection
  const serialPort = new SerialPort({ path: port, baudRate: 115200, autoOpen: false });
  const transport  = new NodeSerialTransport(serialPort);

  const detected = await autoDetect(transport);

  if (!detected) {
    console.error('✗ No board detected. Check the port and ensure the board is connected.');
    await transport.close();
    process.exit(1);
  }

  console.log(`✓ Detected: ${detected.board?.name ?? 'Unknown board'} (${detected.protocol})`);
  if (detected.board) {
    const sig = detected.signature;
    console.log(`  Signature: 0x${sig[0]!.toString(16)} 0x${sig[1]!.toString(16)} 0x${sig[2]!.toString(16)}`);
  }
  console.log('');

  try {
    switch (detected.protocol) {
      case 'stk500v1': {
        const stk = new STK500(transport, detected.board!);
        await stk.bootload(hex, (status, pct) => {
          process.stdout.write(`\r[${String(pct).padStart(3)}%] ${status}          `);
        });
        break;
      }
      case 'stk500v2': {
        const stk = new STK500v2(transport, detected.board!);
        await stk.bootload(hex, (status, pct) => {
          process.stdout.write(`\r[${String(pct).padStart(3)}%] ${status}          `);
        });
        break;
      }
      case 'avr109': {
        const avr = new AVR109(transport, detected.board!);
        await avr.bootload(hex, (status, pct) => {
          process.stdout.write(`\r[${String(pct).padStart(3)}%] ${status}          `);
        });
        break;
      }
    }
    console.log('\n✓ Flash complete!');
  } finally {
    await transport.close();
  }
}

main().catch((err) => {
  console.error('\n✗ Flash failed:', err.message);
  process.exit(1);
});
