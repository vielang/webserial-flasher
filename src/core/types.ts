// Public types and interfaces for arduino-flasher

/** ISP programming parameters used by the STK500v2 programmer */
export interface V2ISPParams {
  /** SPI programming enable timeout (default: 200) */
  timeout?:      number;
  /** Stabilisation delay in ms after entering prog mode (default: 100) */
  stabDelay?:    number;
  /** Command execution delay in ms (default: 25) */
  cmdexeDelay?:  number;
  /** Number of SPI sync loops (default: 32) */
  synchLoops?:   number;
  /** Byte-level delay in µs (default: 0) */
  byteDelay?:    number;
  /** Expected response poll value (default: 0x53) */
  pollValue?:    number;
  /** Byte index of poll value in SPI response (default: 3) */
  pollIndex?:    number;
  /** Chip erase delay in ms (default: 55) */
  eraseDelay?:   number;
  /** Flash write mode byte for CMD_PROGRAM_FLASH_ISP (default: 0xC1) */
  flashMode?:    number;
  /** Flash page write delay in ms (default: 6) */
  flashDelay?:   number;
}

/** Configuration for a specific Arduino / AVR board */
export interface Board {
  /** Human-readable board name */
  name: string;
  /** Baud rate for bootloader communication */
  baudRate: number;
  /** 3-byte AVR device signature (from chip datasheet) */
  signature: Uint8Array;
  /** Flash page size in bytes (128 for ATmega328P, 256 for ATmega2560) */
  pageSize: number;
  /** Command timeout in milliseconds */
  timeout: number;

  // ── Protocol selection ───────────────────────────────────────────────────

  /**
   * Bootloader protocol to use (default: 'stk500v1').
   *   - 'stk500v1' — Classic STK500 protocol (Uno, Nano, Pro Mini, …)
   *   - 'stk500v2' — STK500v2 ISP protocol (Mega 2560, wiring bootloader)
   *   - 'avr109'   — Atmel AVR109 / Caterina CDC protocol (Leonardo, Micro, Pro Micro)
   *   - 'updi'     — Single-wire UPDI (tinyAVR, ATmega4809, AVR Dx/Ex — future)
   */
  protocol?: 'stk500v1' | 'stk500v2' | 'avr109' | 'updi';

  // ── Optional hardware flags ──────────────────────────────────────────────

  /** Use 8-bit addresses instead of 16-bit word addresses (e.g. AVR4809) */
  use8BitAddresses?: boolean;
  /** Reset method: 'dtr' (default), 'rts', or 'none' */
  resetMethod?: 'dtr' | 'rts' | 'none';
  /** Delay in ms after DTR/RTS toggle before attempting sync (default: 200) */
  resetDelayMs?: number;
  /** Total flash capacity in bytes (for HEX validation) */
  flashSize?: number;
  /** EEPROM size in bytes */
  eepromSize?: number;
  /** EEPROM page size in bytes (for STK500v2 descriptor, default: 8) */
  eepromPageSize?: number;
  /** Delay in ms after chip erase (STK500v1 only, default: 10) */
  eraseDelayMs?: number;

  // ── CDC (AVR109) ─────────────────────────────────────────────────────────

  /**
   * Open the port at 1200 baud briefly to trigger bootloader entry
   * before programming. Required for Leonardo/Micro/Pro Micro.
   * Handled by the caller (CDCResetHelper) before constructing AVR109.
   */
  cdc1200BaudReset?: boolean;
  /** Milliseconds to wait for USB re-enumeration after CDC reset (default: 3000) */
  cdcResetWaitMs?: number;

  // ── STK500v2 ISP ─────────────────────────────────────────────────────────

  /** ISP programming parameters for STK500v2 bootloaders */
  ispParams?: V2ISPParams;
  /** Boot section start address in words (for device descriptor) */
  bootAddress?: number;
  /** Boot section size in words (for device descriptor) */
  upperBootSize?: number;
  /** Override the 52-byte STK500v2 device descriptor (expert use) */
  stk500v2Descriptor?: Uint8Array;

  // ── UPDI ─────────────────────────────────────────────────────────────────

  /**
   * Start byte address of flash in data space.
   * tinyAVR 0/1/2 series: 0x8000
   * megaAVR 0 series (ATmega4809): 0x4000
   */
  flashBase?: number;
  /** Base address of the signature row (default: 0x1100) */
  sigrowBase?: number;

  // ── STK500v1 SET_DEVICE parameters ───────────────────────────────────────

  deviceCode?:     number;
  progType?:       number;
  parMode?:        number;
  polling?:        number;
  selfTimed?:      number;
  lockBytes?:      number;
  fuseBytes?:      number;
  flashPollVal1?:  number;
  flashPollVal2?:  number;
  eepromPollVal1?: number;
  eepromPollVal2?: number;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string) => void;

/** Progress callback for bootload() — status label and 0–100 percentage */
export type BootloadProgressCallback = (status: string, percentage: number) => void;

export interface RetryOptions {
  /** How many times to attempt sync before giving up (default: 5) */
  syncAttempts?: number;
  /** Milliseconds to wait between retries (default: 200) */
  retryDelayMs?: number;
}

/** Per-stage timeout overrides (all in milliseconds) */
export interface StageTimeouts {
  /** Timeout for sync / sign-on phase (default: board.timeout) */
  syncMs?: number;
  /** Timeout for signature read (default: board.timeout) */
  signatureMs?: number;
  /** Timeout for chip erase (default: board.timeout) */
  eraseMs?: number;
  /** Timeout for flash upload (default: board.timeout × 3) */
  uploadMs?: number;
  /** Timeout for verify phase (default: board.timeout × 2) */
  verifyMs?: number;
}

export interface STK500Options {
  /** Suppress all logging (overrides logger) */
  quiet?: boolean;
  /** Custom logging function. Receives level + message. */
  logger?: Logger;
  /** Retry configuration */
  retry?: RetryOptions;
  /** Per-stage timeout overrides */
  timeouts?: StageTimeouts;
}
