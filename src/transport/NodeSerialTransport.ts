// Node.js transport adapter for arduino-flasher.
// Works with the `serialport` npm package (https://serialport.io).
//
// Usage:
//   import { SerialPort } from 'serialport';
//   const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200, autoOpen: false });
//   await port.open();  // or pass openImmediately:true
//   const transport = new NodeSerialTransport(port);
//   const stk = new STK500(transport, board);
//   await stk.bootload(hex);
//   await transport.close();

import type { ISTKTransport, SerialSignals } from './ITransport.js';

/**
 * Minimal duck-type interface of the Node.js `serialport` SerialPort class.
 * This avoids a hard dependency on the `serialport` package.
 */
export interface NodeSerialPortLike {
  write(
    data: Buffer | Uint8Array | readonly number[],
    callback?: (err: Error | null | undefined) => void
  ): boolean;
  on(event: 'data', listener: (data: Buffer) => void): this;
  removeListener(event: 'data', listener: (data: Buffer) => void): this;
  set?(
    options: { dtr?: boolean; rts?: boolean; brk?: boolean },
    callback?: (err: Error | null | undefined) => void
  ): void;
  drain?(callback?: (err: Error | null | undefined) => void): void;
  close?(callback?: (err: Error | null | undefined) => void): void;
}

export class NodeSerialTransport implements ISTKTransport {
  // Map user handlers → wrapped handlers so removeListener works correctly
  private readonly handlerMap = new Map<
    (chunk: Uint8Array) => void,
    (data: Buffer) => void
  >();

  constructor(private readonly port: NodeSerialPortLike) {}

  async write(data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  on(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    const wrapped = (buf: Buffer): void => handler(new Uint8Array(buf));
    this.handlerMap.set(handler, wrapped);
    this.port.on('data', wrapped);
  }

  off(_event: 'data', handler: (chunk: Uint8Array) => void): void {
    const wrapped = this.handlerMap.get(handler);
    if (wrapped) {
      this.port.removeListener('data', wrapped);
      this.handlerMap.delete(handler);
    }
  }

  async setSignals(opts: SerialSignals): Promise<void> {
    if (!this.port.set) return; // Port implementation doesn't support signal control
    return new Promise<void>((resolve, reject) => {
      this.port.set!(opts, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Send a BREAK condition for UPDI.
   *
   * Uses hardware SET{brk} if the port supports it (serialport >= 10).
   * Holds TX low for ~12 ms (≥ 12 bit-times at any supported baud rate).
   */
  async sendBreak(): Promise<void> {
    if (!this.port.set) {
      throw new Error(
        'NodeSerialTransport: sendBreak() requires port.set() ' +
        '(not available on this port implementation)'
      );
    }
    await new Promise<void>((resolve, reject) => {
      this.port.set!({ brk: true }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    await new Promise<void>((r) => setTimeout(r, 12)); // ≥12 ms = ≥12 bit-times @ 1 Mbaud
    await new Promise<void>((resolve, reject) => {
      this.port.set!({ brk: false }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    await new Promise<void>((r) => setTimeout(r, 2)); // settling
  }

  async close(): Promise<void> {
    this.handlerMap.clear();
    if (this.port.drain) {
      await new Promise<void>((resolve) => {
        this.port.drain!((err) => {
          if (err) { /* ignore drain errors on close */ }
          resolve();
        });
      });
    }
    if (this.port.close) {
      await new Promise<void>((resolve) => {
        this.port.close!((err) => {
          if (err) { /* ignore */ }
          resolve();
        });
      });
    }
  }
}
