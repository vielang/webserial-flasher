// Built-in board database — Arduino / AVR board configurations.
// Includes official Arduino boards, popular clones, and standalone AVR chips.
//
// Fields:
//   protocol      — which bootloader protocol to use (default: 'stk500v1')
//   signature     — 3-byte chip signature (read back to confirm board type)
//   pageSize      — flash page size for the bootloader
//   baudRate      — bootloader baud rate (CRITICAL: must match exactly)
//   flashSize     — total flash in bytes (including bootloader section)

import type { Board } from '../core/types.js';

export const BOARDS: Readonly<Record<string, Board>> = {

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega328P — 32KB flash, 128-byte pages, STK500v1 @ 115200 / 57600
  // ══════════════════════════════════════════════════════════════════════════

  'arduino-uno': {
    name:         'Arduino Uno (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
    deviceCode:   0x86,
    progType:     0,
    parMode:      1,
    polling:      1,
    selfTimed:    1,
    lockBytes:    1,
    fuseBytes:    3,
    flashPollVal1:  0xff,
    flashPollVal2:  0xff,
    eepromPollVal1: 0xff,
    eepromPollVal2: 0xff,
  },

  'arduino-uno-r3': {
    name:         'Arduino Uno R3 (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-nano': {
    name:         'Arduino Nano (ATmega328P, new bootloader)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-nano-old': {
    name:         'Arduino Nano (ATmega328P, old bootloader 57600)',
    protocol:     'stk500v1',
    baudRate:     57600, // ← old bootloader uses 57600, NOT 115200
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-pro-mini-5v': {
    name:         'Arduino Pro Mini 5V (ATmega328P, 16 MHz)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-pro-mini-3v3': {
    name:         'Arduino Pro Mini 3.3V (ATmega328P, 8 MHz)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-duemilanove-328': {
    name:         'Arduino Duemilanove (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-lilypad': {
    name:         'Arduino LilyPad (ATmega328P, 8 MHz)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'sparkfun-redboard': {
    name:         'SparkFun RedBoard (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-uno-mini': {
    name:         'Arduino Uno Mini (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'lgt8f328p': {
    name:         'LGT8F328P (Arduino Uno clone)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'lgt8f328d': {
    name:         'LGT8F328D (clone, 32KB, 57600)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega168 — 16KB flash, STK500v1 @ 19200
  // ══════════════════════════════════════════════════════════════════════════

  'arduino-duemilanove-168': {
    name:         'Arduino Duemilanove (ATmega168)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x94, 0x06]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    16384,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-diecimila': {
    name:         'Arduino Diecimila (ATmega168)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x94, 0x06]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    16384,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega8 — 8KB flash, STK500v1 @ 19200
  // ══════════════════════════════════════════════════════════════════════════

  'atmega8': {
    name:         'ATmega8 (standalone)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x93, 0x07]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    8192,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega2560 — 256KB flash, 256-byte pages, STK500v2 @ 115200
  // ══════════════════════════════════════════════════════════════════════════

  'arduino-mega2560': {
    name:         'Arduino Mega 2560 (ATmega2560)',
    protocol:     'stk500v2',          // ← wiring bootloader uses STK500v2
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x98, 0x01]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    262144,
    eepromSize:   4096,
    eepromPageSize: 8,
    bootAddress:  0x1F800,             // word address of 4KB boot section
    upperBootSize: 0x0800,             // 2048 words = 4KB
    resetMethod:  'dtr',
    resetDelayMs: 200,
    ispParams: {
      timeout:     200,
      stabDelay:   100,
      cmdexeDelay: 25,
      synchLoops:  32,
      byteDelay:   0,
      pollValue:   0x53,
      pollIndex:   3,
      eraseDelay:  55,
      flashMode:   0xC1,
      flashDelay:  6,
    },
  },

  'arduino-mega1280': {
    name:         'Arduino Mega 1280 (ATmega1280)',
    protocol:     'stk500v2',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x97, 0x03]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    131072,
    eepromSize:   4096,
    eepromPageSize: 8,
    bootAddress:  0xF800,
    upperBootSize: 0x0800,
    resetMethod:  'dtr',
    resetDelayMs: 200,
    ispParams: {
      timeout:     200,
      stabDelay:   100,
      cmdexeDelay: 25,
      synchLoops:  32,
      byteDelay:   0,
      pollValue:   0x53,
      pollIndex:   3,
      eraseDelay:  55,
      flashMode:   0xC1,
      flashDelay:  6,
    },
  },

  'arduino-mega-adk': {
    name:         'Arduino Mega ADK (ATmega2560)',
    protocol:     'stk500v2',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x98, 0x01]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    262144,
    eepromSize:   4096,
    eepromPageSize: 8,
    bootAddress:  0x1F800,
    upperBootSize: 0x0800,
    resetMethod:  'dtr',
    resetDelayMs: 200,
    ispParams: {
      timeout: 200, stabDelay: 100, cmdexeDelay: 25, synchLoops: 32,
      byteDelay: 0, pollValue: 0x53, pollIndex: 3, eraseDelay: 55,
      flashMode: 0xC1, flashDelay: 6,
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega32U4 — 32KB flash, 128-byte pages, AVR109 CDC protocol
  // ══════════════════════════════════════════════════════════════════════════

  'arduino-leonardo': {
    name:            'Arduino Leonardo (ATmega32U4)',
    protocol:        'avr109',           // ← Caterina bootloader = AVR109 protocol
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,              // 32KB - 512B bootloader
    eepromSize:      1024,
    cdc1200BaudReset: true,              // open at 1200 baud to trigger bootloader
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'arduino-micro': {
    name:            'Arduino Micro (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'arduino-lilypad-usb': {
    name:            'Arduino LilyPad USB (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'arduino-esplora': {
    name:            'Arduino Esplora (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'arduino-yun': {
    name:            'Arduino Yún — AVR side (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'sparkfun-pro-micro-5v': {
    name:            'SparkFun Pro Micro 5V / 16 MHz (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  'sparkfun-pro-micro-3v3': {
    name:            'SparkFun Pro Micro 3.3V / 8 MHz (ATmega32U4)',
    protocol:        'avr109',
    baudRate:        57600,
    signature:       new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:        128,
    timeout:         10000,
    flashSize:       32256,
    eepromSize:      1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:  3000,
    resetMethod:     'none',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATtiny family — small flash, 64-byte pages, STK500v1 @ 19200
  // ══════════════════════════════════════════════════════════════════════════

  'attiny13': {
    name:         'ATtiny13 (1KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x90, 0x07]),
    pageSize:     32,
    timeout:      10000,
    flashSize:    1024,
    eepromSize:   64,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny25': {
    name:         'ATtiny25 (2KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x91, 0x08]),
    pageSize:     32,
    timeout:      10000,
    flashSize:    2048,
    eepromSize:   128,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny45': {
    name:         'ATtiny45 (4KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x92, 0x06]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    4096,
    eepromSize:   256,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny85': {
    name:         'ATtiny85 (8KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x93, 0x0b]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    8192,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny24': {
    name:         'ATtiny24 (2KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x91, 0x0b]),
    pageSize:     32,
    timeout:      10000,
    flashSize:    2048,
    eepromSize:   128,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny44': {
    name:         'ATtiny44 (4KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x92, 0x07]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    4096,
    eepromSize:   256,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny84': {
    name:         'ATtiny84 (8KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x93, 0x0c]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    8192,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny2313': {
    name:         'ATtiny2313 (2KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x91, 0x0a]),
    pageSize:     32,
    timeout:      10000,
    flashSize:    2048,
    eepromSize:   128,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'attiny4313': {
    name:         'ATtiny4313 (4KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x92, 0x0d]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    4096,
    eepromSize:   256,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega4809 — 48KB flash, 128-byte pages, megaAVR bootloader (STK500v1 via JTAG2UPDI bridge)
  // ══════════════════════════════════════════════════════════════════════════

  'avr4809': {
    name:             'ATmega4809 (standalone, JTAG2UPDI bridge)',
    protocol:         'stk500v1',
    baudRate:         19200,
    signature:        new Uint8Array([0x1e, 0x96, 0x51]),
    pageSize:         128,
    timeout:          10000,
    flashSize:        49152,
    eepromSize:       256,
    use8BitAddresses: true,
    resetMethod:      'dtr',
    resetDelayMs:     200,
  },

  'arduino-nano-every': {
    name:             'Arduino Nano Every (ATmega4809, JTAG2UPDI bridge)',
    protocol:         'stk500v1',
    baudRate:         19200,
    signature:        new Uint8Array([0x1e, 0x96, 0x51]),
    pageSize:         128,
    timeout:          10000,
    flashSize:        49152,
    eepromSize:       256,
    use8BitAddresses: true,
    resetMethod:      'dtr',
    resetDelayMs:     200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega1284P — 128KB flash, popular homebuilt / Sanguino / MightyCore
  // ══════════════════════════════════════════════════════════════════════════

  'atmega1284p': {
    name:         'ATmega1284P (standalone / Sanguino)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x97, 0x05]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    131072,
    eepromSize:   4096,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'atmega1284p-57600': {
    name:         'ATmega1284P (57600 baud bootloader)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x97, 0x05]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    131072,
    eepromSize:   4096,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega328PB — pin-compatible enhanced variant of 328P
  // ══════════════════════════════════════════════════════════════════════════

  'atmega328pb': {
    name:         'ATmega328PB (enhanced 328P variant)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x16]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega32 / ATmega16 — older classic AVRs
  // ══════════════════════════════════════════════════════════════════════════

  'atmega32': {
    name:         'ATmega32 (32KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x95, 0x02]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'atmega16': {
    name:         'ATmega16 (16KB flash)',
    protocol:     'stk500v1',
    baudRate:     19200,
    signature:    new Uint8Array([0x1e, 0x94, 0x03]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    16384,
    eepromSize:   512,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'atmega644p': {
    name:         'ATmega644P (64KB flash, Sanguino)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x96, 0x0a]),
    pageSize:     256,
    timeout:      10000,
    flashSize:    65536,
    eepromSize:   2048,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Official Arduino variants (additional boards)
  // ══════════════════════════════════════════════════════════════════════════

  'arduino-fio': {
    name:         'Arduino Fio (ATmega328P, 8 MHz, 57600)',
    protocol:     'stk500v1',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'arduino-ethernet': {
    name:         'Arduino Ethernet (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'adafruit-metro-328': {
    name:         'Adafruit Metro 328 (ATmega328P)',
    protocol:     'stk500v1',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   1024,
    resetMethod:  'dtr',
    resetDelayMs: 200,
  },

  'adafruit-flora': {
    name:         'Adafruit Flora (ATmega32U4)',
    protocol:     'avr109',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    28672,
    eepromSize:   1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:   3000,
    resetMethod:  'none',
  },

  'adafruit-feather-32u4': {
    name:         'Adafruit Feather 32u4 (ATmega32U4)',
    protocol:     'avr109',
    baudRate:     57600,
    signature:    new Uint8Array([0x1e, 0x95, 0x87]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    28672,
    eepromSize:   1024,
    cdc1200BaudReset: true,
    cdcResetWaitMs:   3000,
    resetMethod:  'none',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATtiny UPDI series (tinyAVR 0/1/2 — direct UPDI programming)
  // ══════════════════════════════════════════════════════════════════════════

  'attiny412': {
    name:         'ATtiny412 (4KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x91, 0x23]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    4096,
    eepromSize:   128,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny416': {
    name:         'ATtiny416 (4KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x92, 0x21]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    4096,
    eepromSize:   128,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny816': {
    name:         'ATtiny816 (8KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x93, 0x22]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    8192,
    eepromSize:   128,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny1614': {
    name:         'ATtiny1614 (16KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x94, 0x22]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    16384,
    eepromSize:   256,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny1616': {
    name:         'ATtiny1616 (16KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x94, 0x21]),
    pageSize:     64,
    timeout:      10000,
    flashSize:    16384,
    eepromSize:   256,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny3216': {
    name:         'ATtiny3216 (32KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x21]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   256,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  'attiny3217': {
    name:         'ATtiny3217 (32KB flash, UPDI)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x95, 0x22]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    32768,
    eepromSize:   256,
    flashBase:    0x8000,
    resetMethod:  'none',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ATmega4809 — UPDI direct (no JTAG2UPDI bridge)
  // ══════════════════════════════════════════════════════════════════════════

  'atmega4809-updi': {
    name:         'ATmega4809 (direct UPDI programming)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x96, 0x51]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    49152,
    eepromSize:   256,
    flashBase:    0x4000,  // megaAVR 0-series: flash at 0x4000
    resetMethod:  'none',
  },

  'atmega4808-updi': {
    name:         'ATmega4808 (direct UPDI programming)',
    protocol:     'updi',
    baudRate:     115200,
    signature:    new Uint8Array([0x1e, 0x96, 0x50]),
    pageSize:     128,
    timeout:      10000,
    flashSize:    49152,
    eepromSize:   256,
    flashBase:    0x4000,
    resetMethod:  'none',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Raspberry Pi Pico / Pico 2 — PICOBOOT USB protocol
  //
  // These boards use the PICOBOOT binary USB protocol when held in BOOTSEL
  // mode (hold BOOTSEL button while plugging USB).
  //
  // Note: baudRate, signature, pageSize are not used by the PICOBOOT
  // programmer — they are set to neutral values for type compatibility.
  // Use vid/pid for device detection and flashSize for firmware validation.
  // ══════════════════════════════════════════════════════════════════════════

  'raspberry-pi-pico': {
    name:         'Raspberry Pi Pico (RP2040)',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),  // VID/PID hint
    pageSize:     256,   // PICOBOOT flash page size
    timeout:      15000,
    flashSize:    2 * 1024 * 1024,  // 2 MB (W25Q16JV)
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },

  'raspberry-pi-pico-w': {
    name:         'Raspberry Pi Pico W (RP2040 + CYW43439)',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),
    pageSize:     256,
    timeout:      15000,
    flashSize:    2 * 1024 * 1024,  // 2 MB
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },

  'raspberry-pi-pico-2': {
    name:         'Raspberry Pi Pico 2 (RP2350)',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x0F]),  // PID 0x000F hint
    pageSize:     256,
    timeout:      15000,
    flashSize:    4 * 1024 * 1024,  // 4 MB (W25Q32JV)
    vid:          0x2E8A,
    pid:          0x000F,
    resetMethod:  'none',
  },

  'adafruit-feather-rp2040': {
    name:         'Adafruit Feather RP2040',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),
    pageSize:     256,
    timeout:      15000,
    flashSize:    8 * 1024 * 1024,  // 8 MB (W25Q64JV)
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },

  'adafruit-qt-py-rp2040': {
    name:         'Adafruit QT Py RP2040',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),
    pageSize:     256,
    timeout:      15000,
    flashSize:    8 * 1024 * 1024,  // 8 MB
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },

  'sparkfun-pro-micro-rp2040': {
    name:         'SparkFun Pro Micro RP2040',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),
    pageSize:     256,
    timeout:      15000,
    flashSize:    16 * 1024 * 1024,  // 16 MB (W25Q128JV)
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },

  'waveshare-rp2040-zero': {
    name:         'Waveshare RP2040-Zero',
    protocol:     'picoboot',
    baudRate:     0,
    signature:    new Uint8Array([0x2E, 0x8A, 0x03]),
    pageSize:     256,
    timeout:      15000,
    flashSize:    2 * 1024 * 1024,  // 2 MB
    vid:          0x2E8A,
    pid:          0x0003,
    resetMethod:  'none',
  },
};

// ── Lookup helpers ─────────────────────────────────────────────────────────

/**
 * Find a board by its 3-byte device signature.
 * Returns the first match, or null if no board matches.
 * Note: multiple boards share the same signature (e.g. all ATmega328P variants).
 */
export function detectBoardBySignature(signature: Uint8Array): Board | null {
  for (const board of Object.values(BOARDS)) {
    if (
      signature.length >= 3 &&
      board.signature.length === 3 &&
      signature[0] === board.signature[0] &&
      signature[1] === board.signature[1] &&
      signature[2] === board.signature[2]
    ) {
      return board;
    }
  }
  return null;
}

/** arduino-cli FQBN → board database key */
const FQBN_MAP: Readonly<Record<string, string>> = {
  // Arduino official
  'arduino:avr:uno':           'arduino-uno',
  'arduino:avr:nano':          'arduino-nano',
  'arduino:avr:mega':          'arduino-mega2560',
  'arduino:avr:mega2560':      'arduino-mega2560',
  'arduino:avr:megaADK':       'arduino-mega-adk',
  'arduino:avr:leonardo':      'arduino-leonardo',
  'arduino:avr:micro':         'arduino-micro',
  'arduino:avr:mini':          'arduino-pro-mini-5v',
  'arduino:avr:pro':           'arduino-pro-mini-5v',
  'arduino:avr:diecimila':     'arduino-diecimila',
  'arduino:avr:duemilanove':   'arduino-duemilanove-328',
  'arduino:avr:lilypad':       'arduino-lilypad',
  'arduino:avr:lilypadUSB':    'arduino-lilypad-usb',
  'arduino:avr:esplora':       'arduino-esplora',
  'arduino:avr:yun':           'arduino-yun',
  'arduino:megaavr:nona4809':  'arduino-nano-every',
  'arduino:avr:fio':           'arduino-fio',
  'arduino:avr:ethernet':      'arduino-ethernet',
  // SparkFun
  'SparkFun:avr:RedBoard':     'sparkfun-redboard',
  'SparkFun:avr:promicro':     'sparkfun-pro-micro-5v',
  'sparkfun:avr:RedBoard':     'sparkfun-redboard',
  'sparkfun:avr:promicro':     'sparkfun-pro-micro-5v',
  // Adafruit
  'adafruit:avr:flora8':       'adafruit-flora',
  'adafruit:avr:feather32u4':  'adafruit-feather-32u4',
  'adafruit:avr:metro':        'adafruit-metro-328',
  // MegaCoreX / MightyCore
  'MegaCoreX:megaavr:4809':    'atmega4809-updi',
  'MegaCore:avr:1284':         'atmega1284p',
  // Raspberry Pi
  'rp2040:rp2040:rpipico':     'raspberry-pi-pico',
  'rp2040:rp2040:rpipicow':    'raspberry-pi-pico-w',
  'rp2040:rp2040:rpipico2':    'raspberry-pi-pico-2',
  // Adafruit RP2040
  'adafruit:rp2040:feather':   'adafruit-feather-rp2040',
  'adafruit:rp2040:qtpy':      'adafruit-qt-py-rp2040',
  // SparkFun RP2040
  'SparkFun:rp2040:promicro':  'sparkfun-pro-micro-rp2040',
};

/**
 * Get a board config from an arduino-cli FQBN string.
 * Returns null if the FQBN is not recognised.
 * @example boardFromFqbn('arduino:avr:mega') → BOARDS['arduino-mega2560']
 */
export function boardFromFqbn(fqbn: string): Board | null {
  const key = FQBN_MAP[fqbn];
  return key != null ? (BOARDS[key] ?? null) : null;
}

/** USB Vendor IDs for board auto-detection in WebSerial requestPort() */
export const ARDUINO_USB_VENDOR_IDS: readonly number[] = [
  0x2341, // Arduino LLC (official boards)
  0x1a86, // QinHeng Electronics (CH340 / CH341 — clones)
  0x0403, // FTDI (many shields and programmers)
  0x10c4, // Silicon Labs (CP2102 / CP2109)
  0x067b, // Prolific Technology (PL2303)
  0x03eb, // Atmel Corporation (ATmega32U4 native USB)
  0x1b4f, // SparkFun Electronics
];
