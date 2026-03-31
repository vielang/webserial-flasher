// Browser WebSerial API transport for webserial-flasher.
// Works in Chrome 89+ and Edge 89+. Not available in Firefox or Safari.
//
// Usage:
//   const transport = await WebSerialTransport.requestPort([{ usbVendorId: 0x2341 }]);
//   await transport.open(115200);
//   const stk = new STK500(transport, board);
//   await stk.bootload(hex);
//   await transport.close();

import type { ISTKTransport, SerialSignals } from './ITransport.js';

export interface WebSerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

// WebSerial API types — present in browsers but not in TypeScript's DOM lib at ES2020 target.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSerialPort = any;

/** Options passed to WebSerial port.open() */
export interface WebSerialOpenOptions {
  /** Baud rate (required) */
  baudRate: number;
  /** Data bits (default: 8) */
  dataBits?: 7 | 8;
  /** Stop bits (default: 1) — use 2 for UPDI */
  stopBits?: 1 | 2;
  /** Parity (default: 'none') — use 'even' for UPDI */
  parity?: 'none' | 'even' | 'odd';
  /** Flow control (default: 'none') */
  flowControl?: 'none' | 'hardware';
}

export class WebSerialTransport implements ISTKTransport {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopActive = false;
  private readonly listeners = new Set<(data: Uint8Array) => void>();
  private lastOpenOptions: WebSerialOpenOptions | null = null;

  constructor(private readonly port: WebSerialPort) {}

  /** Check whether WebSerial is available in the current environment */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  /**
   * Show the browser's port-picker dialog and return a transport wrapping the selected port.
   * @param filters - Optional USB vendor/product ID filters to narrow the list shown to the user
   */
  static async requestPort(
    filters: WebSerialPortFilter[] = []
  ): Promise<WebSerialTransport> {
    if (!WebSerialTransport.isSupported()) {
      throw new Error(
        'WebSerial API is not supported. Use Chrome 89+ or Edge 89+.'
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const port: WebSerialPort = await (navigator as any).serial.requestPort({ filters });
    return new WebSerialTransport(port);
  }

  /**
   * Return transports for all previously-approved ports (no dialog).
   * Useful for re-connecting without prompting the user again.
   */
  static async getPorts(): Promise<WebSerialTransport[]> {
    if (!WebSerialTransport.isSupported()) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ports: WebSerialPort[] = await (navigator as any).serial.getPorts();
    return ports.map((p) => new WebSerialTransport(p));
  }

  /** Open the serial port at the given baud rate with optional serial settings */
  async open(baudRate: number, options?: Partial<WebSerialOpenOptions>): Promise<void> {
    const opts: WebSerialOpenOptions = {
      baudRate,
      dataBits:    options?.dataBits    ?? 8,
      stopBits:    options?.stopBits    ?? 1,
      parity:      options?.parity      ?? 'none',
      flowControl: options?.flowControl ?? 'none',
    };
    this.lastOpenOptions = opts;
    await this.port.open(opts);
    this.writer = this.port.writable!.getWriter();
    this.reader = this.port.readable!.getReader();
    this.readLoopActive = true;
    this.startReadLoop();
  }

  /**
   * Send a BREAK condition to reset the UPDI state machine.
   *
   * Implementation: close the port, reopen at 300 baud 8N1, transmit 0x00
   * (which produces a ~33 ms break period relative to 115200 baud), then
   * reopen at the original settings.
   *
   * The current port must have been opened with open() before calling this.
   */
  async sendBreak(): Promise<void> {
    if (!this.lastOpenOptions) {
      throw new Error('WebSerialTransport: call open() before sendBreak()');
    }
    const originalOptions = { ...this.lastOpenOptions };

    // 1. Tear down current connection
    await this._closePort();

    // 2. Reopen at 300 baud to generate a BREAK pulse
    await this.port.open({ baudRate: 300, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    const breakWriter = this.port.writable!.getWriter();
    await breakWriter.write(new Uint8Array([0x00])); // 0x00 at 300 baud ≈ 33 ms low
    await new Promise<void>((r) => setTimeout(r, 50)); // ensure byte clocks out
    breakWriter.releaseLock();
    await this.port.close();

    // 3. Reopen at original settings
    await this.port.open(originalOptions);
    this.writer = this.port.writable!.getWriter();
    this.reader = this.port.readable!.getReader();
    this.readLoopActive = true;
    this.startReadLoop();
  }

  /** Internal helper: close writer, reader, and port without clearing lastOpenOptions */
  private async _closePort(): Promise<void> {
    this.readLoopActive = false;
    this.listeners.clear();
    try { await this.reader?.cancel(); } catch { /* ignore */ }
    try { this.reader?.releaseLock(); } catch { /* ignore */ }
    try { await this.writer?.abort(); } catch { /* ignore */ }
    try { this.writer?.releaseLock(); } catch { /* ignore */ }
    try { await this.port.close(); } catch { /* ignore */ }
    this.reader = null;
    this.writer = null;
  }

  /** Set DTR/RTS hardware signals to trigger Arduino bootloader entry */
  async setSignals(opts: SerialSignals): Promise<void> {
    // WebSerialPort.setSignals is defined in the WebSerial spec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.port as any).setSignals(opts);
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Transport not open — call open() first');
    await this.writer.write(data);
  }

  on(_event: 'data', handler: (data: Uint8Array) => void): void {
    this.listeners.add(handler);
  }

  off(_event: 'data', handler: (data: Uint8Array) => void): void {
    this.listeners.delete(handler);
  }

  private startReadLoop(): void {
    void (async () => {
      while (this.readLoopActive) {
        try {
          const { value, done } = await this.reader!.read();
          if (done || !this.readLoopActive) break;
          if (value && value.byteLength > 0) {
            this.listeners.forEach((fn) => fn(value));
          }
        } catch {
          // Port closed externally or connection lost — stop loop silently
          break;
        }
      }
    })();
  }

  async close(): Promise<void> {
    this.lastOpenOptions = null;
    await this._closePort();
  }
}
