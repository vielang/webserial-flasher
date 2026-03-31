/**
 * Flash a Raspberry Pi Pico (RP2040) or Pico 2 (RP2350) using PICOBOOT protocol.
 *
 * Requirements:
 *   npm install usb          ← required for USB access
 *
 * How to enter BOOTSEL mode:
 *   1. Hold the BOOTSEL button on the Pico
 *   2. Connect USB while holding BOOTSEL
 *   3. Release BOOTSEL — the Pico appears as a USB drive AND as a PICOBOOT device
 *
 * Accepted file formats:
 *   - .uf2  — standard Pico firmware format (recommended)
 *   - .bin  — raw binary (assumed to start at 0x10000000)
 *
 * Usage:
 *   npx tsx examples/node/flash-pico.ts firmware.uf2
 *   npx tsx examples/node/flash-pico.ts firmware.bin
 *
 * Linux note: you may need udev rules or run with sudo:
 *   echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", MODE="0666"' | sudo tee /etc/udev/rules.d/99-pico.rules
 *   sudo udevadm control --reload-rules
 */

import fs from 'fs/promises';
import { PicoBoot, NodeUSBTransport } from 'webserial-flasher';

async function main() {
  const [, , firmwareFile] = process.argv;

  if (!firmwareFile) {
    console.error('Usage: npx tsx flash-pico.ts <firmware.uf2|firmware.bin>');
    process.exit(1);
  }

  console.log(`File  : ${firmwareFile}`);
  console.log('');
  console.log('Looking for Raspberry Pi Pico in BOOTSEL mode…');
  console.log('(Hold BOOTSEL while connecting USB if not found)');
  console.log('');

  const firmware = await fs.readFile(firmwareFile);
  const data     = new Uint8Array(firmware.buffer, firmware.byteOffset, firmware.byteLength);

  // NodeUSBTransport.open() finds the first RP2040/RP2350 in BOOTSEL mode
  const transport = await NodeUSBTransport.open();
  const pico      = new PicoBoot(transport);

  try {
    await pico.bootload(data, (status, pct) => {
      process.stdout.write(`\r[${String(pct).padStart(3)}%] ${status}          `);
    });
    console.log('\n✓ Flash complete! Pico is rebooting…');
  } finally {
    await transport.close();
  }
}

main().catch((err) => {
  console.error('\n✗ Flash failed:', err.message);
  if (err.message?.includes("'usb' is not installed")) {
    console.error('\nRun: npm install usb');
  }
  process.exit(1);
});
