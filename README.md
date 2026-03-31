# webserial-flasher

[![npm](https://img.shields.io/npm/v/webserial-flasher)](https://www.npmjs.com/package/webserial-flasher)
[![license](https://img.shields.io/npm/l/webserial-flasher)](LICENSE)
[![types](https://img.shields.io/npm/types/webserial-flasher)](https://www.npmjs.com/package/webserial-flasher)

Multi-protocol firmware flasher for Arduino, AVR, and Raspberry Pi boards.
Supports **Node.js** and **browser** (WebSerial API). Written in TypeScript, ships as pure ESM.

## Supported Protocols

| Protocol | Boards | Environment |
|---|---|---|
| **STK500v1** | Arduino Uno, Nano, Pro Mini, Mini, … | Node.js + Browser |
| **STK500v2** | Arduino Mega 2560 | Node.js + Browser |
| **AVR109** | Arduino Leonardo, Micro, Pro Micro | Node.js + Browser |
| **UPDI** | ATtiny416/816/1616/3216/3217, ATmega4809, Nano Every | Node.js |
| **PICOBOOT** | Raspberry Pi Pico (RP2040), Pico W, Pico 2 (RP2350) | Node.js |

## Installation

```bash
npm install webserial-flasher
```

For Raspberry Pi Pico support (PICOBOOT via USB):

```bash
npm install webserial-flasher usb
```

## Quick Start

### Arduino Uno — Node.js

```typescript
import { SerialPort } from 'serialport';
import { STK500, NodeSerialTransport, BOARDS } from 'webserial-flasher';
import fs from 'fs/promises';

const board = BOARDS['arduino-uno']!;
const hex   = await fs.readFile('firmware.hex', 'utf8');

const serial    = new SerialPort({ path: '/dev/ttyACM0', baudRate: board.baudRate, autoOpen: false });
const transport = new NodeSerialTransport(serial);
const stk       = new STK500(transport, board);

await stk.bootload(hex, (status, pct) => console.log(`[${pct}%] ${status}`));
await transport.close();
```

### Arduino — Browser (WebSerial)

```typescript
import { STK500, WebSerialTransport, BOARDS } from 'webserial-flasher';

const board     = BOARDS['arduino-uno']!;
const transport = new WebSerialTransport();

await transport.requestPort();         // opens browser port picker
await transport.open(board.baudRate);

const stk = new STK500(transport, board);
await stk.bootload(hexString, (status, pct) => {
  progressBar.value = pct;
});

await transport.close();
```

### Raspberry Pi Pico (RP2040) — Node.js

```typescript
import { PicoBoot, NodeUSBTransport } from 'webserial-flasher';
import fs from 'fs/promises';

// Hold BOOTSEL button while connecting USB
const transport = await NodeUSBTransport.open();  // auto-detects Pico
const pico      = new PicoBoot(transport);

const uf2 = new Uint8Array(await fs.readFile('firmware.uf2'));
await pico.bootload(uf2, (status, pct) => console.log(`[${pct}%] ${status}`));
await transport.close();
```

## Board Database

Over 60 boards built-in. Access by key or FQBN:

```typescript
import { BOARDS, boardFromFqbn } from 'webserial-flasher';

const uno   = BOARDS['arduino-uno'];
const mega  = BOARDS['arduino-mega2560'];
const pico  = BOARDS['raspberry-pi-pico'];
const board = boardFromFqbn('arduino:avr:nano');
```

<details>
<summary>All supported board keys</summary>

**STK500v1**
`arduino-uno`, `arduino-uno-r3`, `arduino-nano`, `arduino-nano-every`,
`arduino-mega2560`, `arduino-mega-adk`, `arduino-pro-mini-5v`, `arduino-pro-mini-3v3`,
`arduino-mini`, `arduino-lilypad`, `arduino-lilypad-usb`, `arduino-esplora`, `arduino-yun`,
`arduino-fio`, `arduino-ethernet`, `sparkfun-redboard`, `sparkfun-pro-mini-5v`,
`sparkfun-pro-mini-3v3`, `lgt8f328p`, `atmega1284p`, `atmega328pb`, `atmega32`, `atmega16`,
`adafruit-metro-328`, `adafruit-flora`

**STK500v2**
`arduino-mega2560`, `arduino-mega-adk`

**AVR109 / Caterina**
`arduino-leonardo`, `arduino-micro`, `sparkfun-pro-micro-5v`, `sparkfun-pro-micro-3v3`,
`adafruit-feather-32u4`

**UPDI**
`attiny412`, `attiny416`, `attiny816`, `attiny1614`, `attiny1616`, `attiny3216`,
`attiny3217`, `atmega4809-updi`, `atmega4808-updi`

**PICOBOOT (RP2040 / RP2350)**
`raspberry-pi-pico`, `raspberry-pi-pico-w`, `raspberry-pi-pico-2`,
`adafruit-feather-rp2040`, `adafruit-qt-py-rp2040`,
`sparkfun-pro-micro-rp2040`, `waveshare-rp2040-zero`

</details>

## API Reference

### STK500 — Arduino Uno / Nano / Pro Mini

```typescript
const stk = new STK500(transport, board, opts?);

await stk.bootload(hex, progressCallback?);   // full flash sequence
await stk.sync(attempts?);
await stk.verifySignature();
await stk.upload(hex, progressCallback?);
await stk.verify(hex, progressCallback?);
await stk.readFuses();                        // { low, high, ext, lock }
await stk.writeFuse('low', 0xFF);
await stk.readEepromPage(addr, size);
await stk.writeEepromPage(addr, data);
```

### STK500v2 — Arduino Mega 2560

```typescript
const stk = new STK500v2(transport, board, opts?);

await stk.bootload(hex, progressCallback?);
await stk.readFuses();                        // { low, high, ext, lock }
await stk.readEeprom(addr, size);
await stk.programEeprom(addr, data);
```

### AVR109 — Leonardo / Micro / Pro Micro

```typescript
const avr = new AVR109(transport, board, opts?);

await avr.bootload(hex, progressCallback?);
await avr.readFuses();                        // { low, high, lock }
```

### UPDI — ATtiny / ATmega 0-series

```typescript
const updi = new UPDI(transport, board, opts?);

await updi.bootload(hex, progressCallback?);
await updi.sendBreak();
await updi.sync(attempts?);
await updi.enterProgMode();
await updi.chipErase();
await updi.getSignature();                    // Uint8Array [3 bytes]
await updi.readFuses();                       // { fuse0, fuse1, fuse2, fuse4, fuse5 }
await updi.writeFuse(index, value);
await updi.writeEeprom(offset, data);
await updi.readEeprom(offset, size);
await updi.leaveProgMode();
```

### PicoBoot — Raspberry Pi Pico (RP2040 / RP2350)

```typescript
const pico = new PicoBoot(transport, opts?);

// Accepts .uf2 file (auto-detected by magic bytes) or raw binary
await pico.bootload(uf2OrBinary, progressCallback?, { baseAddr?, verify? });

await pico.exclusiveAccess(true);             // take control, disable USB drive
await pico.exitXip();                         // required before erase/write
await pico.flashErase(addr, size);            // erase sectors (4KB-aligned)
await pico.flashWrite(addr, data);            // write 256-byte page
await pico.flashRead(addr, size);             // read back flash
await pico.reboot(pc?, sp?, delayMs?);        // reboot from flash
```

### UF2 Utilities

```typescript
import { parseUf2, binaryToUf2, isUf2 } from 'webserial-flasher';

isUf2(data);                                  // detect UF2 by magic bytes
parseUf2(uf2Data);                            // { binary, baseAddr, familyId, blocks }
binaryToUf2(binary, baseAddr?, familyId?);    // Uint8Array (.uf2 file)
```

### Auto-Detection

```typescript
import { autoDetect } from 'webserial-flasher';

const result = await autoDetect(transport);
// { protocol: 'stk500v1', board: Board, signature: Uint8Array } | null
// Note: UPDI and PICOBOOT cannot be auto-detected
```

### Progress Callback

```typescript
await stk.bootload(hex, (status: string, percentage: number) => {
  console.log(`[${percentage}%] ${status}`);
  // 'Syncing' | 'Verifying signature' | 'Uploading' | 'Verifying' | 'Complete'
});
```

### Options

```typescript
const opts = {
  quiet:  false,
  logger: (level, msg) => console.log(msg),
  retry: {
    syncAttempts: 5,
    retryDelayMs: 200,
  },
  timeouts: {
    syncMs:      5000,
    signatureMs: 5000,
    eraseMs:     10000,
    uploadMs:    30000,
    verifyMs:    20000,
  },
};
```

### Error Handling

```typescript
import {
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  STK500TimeoutError,
  STK500ProtocolError,
  STK500InvalidHexError,
} from 'webserial-flasher';

try {
  await stk.bootload(hex);
} catch (err) {
  if (err instanceof STK500SyncError) {
    console.error(`Sync failed after ${err.attempts} attempts`);
  } else if (err instanceof STK500SignatureMismatchError) {
    console.error('Wrong board — expected:', err.expected, 'got:', err.actual);
  } else if (err instanceof STK500VerifyError) {
    console.error(`Verify failed at 0x${err.address.toString(16)}`);
  }
}
```

## Examples

| File | Description |
|---|---|
| [`examples/node/flash-uno.ts`](examples/node/flash-uno.ts) | Flash Arduino Uno (STK500v1) |
| [`examples/node/flash-mega2560.ts`](examples/node/flash-mega2560.ts) | Flash Arduino Mega 2560 (STK500v2) |
| [`examples/node/flash-leonardo.ts`](examples/node/flash-leonardo.ts) | Flash Arduino Leonardo (AVR109) |
| [`examples/node/flash-attiny.ts`](examples/node/flash-attiny.ts) | Flash ATtiny / ATmega via UPDI |
| [`examples/node/flash-pico.ts`](examples/node/flash-pico.ts) | Flash Raspberry Pi Pico (PICOBOOT) |
| [`examples/node/auto-detect.ts`](examples/node/auto-detect.ts) | Auto-detect protocol and flash |
| [`examples/browser/webserial-flash.ts`](examples/browser/webserial-flash.ts) | Browser WebSerial flash + framework helper |

```bash
npm install serialport

npx tsx examples/node/flash-uno.ts /dev/ttyACM0 firmware.hex
npx tsx examples/node/flash-mega2560.ts COM3 firmware.hex
npx tsx examples/node/flash-attiny.ts /dev/ttyUSB0 firmware.hex attiny416

npm install usb
npx tsx examples/node/flash-pico.ts firmware.uf2
```

## Requirements

| | Minimum |
|---|---|
| Node.js | 18.0.0 |
| Chrome / Edge | 89 (WebSerial API) |
| `serialport` | peer dependency (Node.js serial) |
| `usb` | peer dependency, optional (Pico only) |

## License

MIT © [Vie Lang](https://github.com/vielang)
