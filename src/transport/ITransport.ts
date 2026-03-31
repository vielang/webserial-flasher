// Minimal transport interface that stk500 requires.
// Decouples the protocol logic from any specific I/O backend (Node.js, WebSerial, mock).

export interface SerialSignals {
  dtr?: boolean;
  rts?: boolean;
}

export interface ISTKTransport {
  /** Send raw bytes to the device */
  write(data: Uint8Array): Promise<void>;

  /** Subscribe to incoming data chunks */
  on(event: 'data', handler: (chunk: Uint8Array) => void): void;

  /** Unsubscribe a data handler */
  off(event: 'data', handler: (chunk: Uint8Array) => void): void;

  /**
   * Set hardware handshake signals.
   * Optional — not all transports support it.
   * Used to toggle DTR/RTS for Arduino bootloader entry.
   */
  setSignals?(opts: SerialSignals): Promise<void>;

  /**
   * Send a BREAK condition on the serial line.
   * Required for UPDI protocol — used to reset the UPDI state machine.
   *
   * Implementations should hold TX low for ≥ 12 bit-times (e.g. by sending 0x00
   * at 300 baud, which produces a ~33 ms BREAK period at 115200 operating speed).
   * WebSerialTransport closes/reopens the port; NodeSerialTransport uses hardware
   * SET{brk} if available, falling back to the low-baud approach.
   *
   * Optional — only required for UPDI.
   */
  sendBreak?(): Promise<void>;

  /** Release all resources */
  close(): Promise<void>;
}
