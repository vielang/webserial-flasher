// arduino-flasher — public API
//
// Default export: STK500 class (backward compatible with v1.x)
// Named exports: everything needed for typed usage across all supported protocols

// ── Protocol programmers ──────────────────────────────────────────────────

export { STK500 } from './stk500.js';
export { STK500 as default } from './stk500.js';
export { STK500v2 } from './protocol/stk500v2/programmer.js';
export { AVR109 }   from './protocol/avr109/programmer.js';
export { UPDI }     from './protocol/updi/programmer.js';
export type { UPDIFuses } from './protocol/updi/programmer.js';

// ── Auto-detection ────────────────────────────────────────────────────────

export { autoDetect } from './autoDetect.js';
export type { AutoDetectResult, AutoDetectOptions } from './autoDetect.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type {
  Board,
  V2ISPParams,
  STK500Options,
  RetryOptions,
  StageTimeouts,
  BootloadProgressCallback,
  LogLevel,
  Logger,
} from './core/types.js';

// ── Errors ────────────────────────────────────────────────────────────────

export {
  STK500ErrorCode,
  STK500Error,
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  STK500TimeoutError,
  STK500ProtocolError,
  STK500InvalidHexError,
  STK500PortError,
} from './core/errors.js';

// ── Transport ─────────────────────────────────────────────────────────────

export { WebSerialTransport }   from './transport/WebSerialTransport.js';
export { NodeSerialTransport }  from './transport/NodeSerialTransport.js';
export type { ISTKTransport, SerialSignals }     from './transport/ITransport.js';
export type { WebSerialPortFilter, WebSerialOpenOptions } from './transport/WebSerialTransport.js';
export type { NodeSerialPortLike }               from './transport/NodeSerialTransport.js';

// ── Board database ────────────────────────────────────────────────────────

export {
  BOARDS,
  boardFromFqbn,
  detectBoardBySignature,
  ARDUINO_USB_VENDOR_IDS,
} from './boards/database.js';

// ── HEX parser (exposed for tooling / testing) ────────────────────────────

export { parseIntelHex }      from './protocol/hexParser.js';
export type { ParseResult }   from './protocol/hexParser.js';
