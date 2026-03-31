// Typed error hierarchy for arduino-flasher
// Callers can use instanceof to distinguish error types and show appropriate UI

export enum STK500ErrorCode {
  SYNC_FAILED         = 'STK_SYNC_FAILED',
  SIGNATURE_MISMATCH  = 'STK_SIGNATURE_MISMATCH',
  VERIFY_FAILED       = 'STK_VERIFY_FAILED',
  TIMEOUT             = 'STK_TIMEOUT',
  PORT_ERROR          = 'STK_PORT_ERROR',
  INVALID_HEX         = 'STK_INVALID_HEX',
  PROTOCOL_ERROR      = 'STK_PROTOCOL_ERROR',
  CHIP_ERASE_FAILED   = 'STK_CHIP_ERASE_FAILED',
  NOT_SUPPORTED       = 'STK_NOT_SUPPORTED',
}

export class STK500Error extends Error {
  constructor(
    public readonly code: STK500ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'STK500Error';
    // Restore prototype chain for correct instanceof checks in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500SyncError extends STK500Error {
  constructor(public readonly attempts: number) {
    super(
      STK500ErrorCode.SYNC_FAILED,
      `Sync failed after ${attempts} attempts. ` +
        `Troubleshooting: (1) Is the correct COM port selected? ` +
        `(2) Is the baud rate correct for this board? ` +
        `(3) Is the Arduino connected and powered? ` +
        `(4) Try pressing the Reset button just before flashing if DTR is not available.`
    );
    this.name = 'STK500SyncError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500SignatureMismatchError extends STK500Error {
  constructor(
    public readonly expected: Uint8Array,
    public readonly actual: Uint8Array
  ) {
    const fmt = (b: Uint8Array): string =>
      Array.from(b)
        .map((x) => `0x${x.toString(16).padStart(2, '0')}`)
        .join(', ');
    super(
      STK500ErrorCode.SIGNATURE_MISMATCH,
      `Signature mismatch: expected [${fmt(expected)}], got [${fmt(actual)}]. ` +
        `Did you select the wrong board type?`
    );
    this.name = 'STK500SignatureMismatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500VerifyError extends STK500Error {
  constructor(
    public readonly address: number,
    public readonly expected: number,
    public readonly actual: number
  ) {
    super(
      STK500ErrorCode.VERIFY_FAILED,
      `Verify failed at address 0x${address.toString(16).padStart(4, '0')}: ` +
        `expected 0x${expected.toString(16).padStart(2, '0')}, ` +
        `got 0x${actual.toString(16).padStart(2, '0')}. ` +
        `The flash write may have been corrupted.`
    );
    this.name = 'STK500VerifyError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500TimeoutError extends STK500Error {
  constructor(
    public readonly timeoutMs: number,
    context?: string
  ) {
    super(
      STK500ErrorCode.TIMEOUT,
      `Timeout after ${timeoutMs}ms${context ? ` (${context})` : ''}`
    );
    this.name = 'STK500TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500ProtocolError extends STK500Error {
  constructor(message: string) {
    super(STK500ErrorCode.PROTOCOL_ERROR, message);
    this.name = 'STK500ProtocolError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500InvalidHexError extends STK500Error {
  constructor(message: string, public readonly line?: number) {
    super(STK500ErrorCode.INVALID_HEX, message);
    this.name = 'STK500InvalidHexError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class STK500PortError extends STK500Error {
  constructor(message: string) {
    super(STK500ErrorCode.PORT_ERROR, message);
    this.name = 'STK500PortError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
