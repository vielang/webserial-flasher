// Node.js USB transport for the PICOBOOT protocol.
// Requires the 'usb' npm package: npm install usb
//
// Usage:
//   const transport = await NodeUSBTransport.open();
//   const pico = new PicoBoot(transport);
//   await pico.bootload(uf2Data);
//   await transport.close();

import type { IPicobootTransport } from './IPicobootTransport.js';
import { PICOBOOT_INTERFACE } from '../protocol/picoboot/constants.js';
import { STK500ProtocolError } from '../core/errors.js';

export class NodeUSBTransport implements IPicobootTransport {
  private readonly device:  unknown;
  private readonly iface:   unknown;
  private readonly outEp:   unknown;
  private readonly inEp:    unknown;

  private constructor(device: unknown, iface: unknown, outEp: unknown, inEp: unknown) {
    this.device = device;
    this.iface  = iface;
    this.outEp  = outEp;
    this.inEp   = inEp;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /**
   * Find the first RP2040 / RP2350 in BOOTSEL mode, claim the PICOBOOT
   * interface, and return a ready-to-use transport instance.
   *
   * @param vid  USB Vendor ID (default: 0x2E8A — Raspberry Pi)
   * @param pid  USB Product ID (default: 0x0003 — RP2040 USBBOOT)
   * @throws STK500ProtocolError if the 'usb' package is missing or no device found
   */
  static async open(vid = 0x2E8A, pid = 0x0003): Promise<NodeUSBTransport> {
    // Dynamic import: 'usb' is an optional peer dependency.
    // The new Function wrapper prevents TypeScript from resolving 'usb' statically,
    // avoiding build errors when the package is not installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let usbModule: any;
    try {
      // eslint-disable-next-line no-new-func
      usbModule = await (new Function('m', 'return import(m)'))('usb');
    } catch {
      throw new STK500ProtocolError(
        "Package 'usb' is not installed. Run: npm install usb"
      );
    }

    const device = (usbModule.findByIds ?? usbModule.default?.findByIds)?.(vid, pid);
    if (!device) {
      throw new STK500ProtocolError(
        `No device found in BOOTSEL mode ` +
        `(VID=0x${vid.toString(16).toUpperCase()}, PID=0x${pid.toString(16).toUpperCase()}). ` +
        'Hold the BOOTSEL button while connecting USB.'
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dev = device as any;
    dev.open();

    // Interface 1 = PICOBOOT (vendor class 0xFF).
    // If the device only exposes 1 interface (MSD without PICOBOOT), that is interface 0.
    const ifaceCount = dev.interfaces?.length ?? 0;
    const ifaceIndex = ifaceCount >= 2 ? PICOBOOT_INTERFACE : 0;
    const iface = dev.interface(ifaceIndex);

    // Detach kernel driver on Linux / macOS if necessary
    try {
      if (iface.isKernelDriverActive?.()) {
        iface.detachKernelDriver();
      }
    } catch {
      // Not available on Windows — silently ignore
    }

    iface.claim();

    // Discover OUT and IN bulk endpoints dynamically (endpoint addresses vary
    // between bootrom revisions)
    let outEp: unknown = null;
    let inEp:  unknown = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ep of (iface.endpoints as any[])) {
      if (ep.direction === 'out') outEp = ep;
      else if (ep.direction === 'in') inEp = ep;
    }

    if (!outEp || !inEp) {
      try { dev.close(); } catch { /* ignore */ }
      throw new STK500ProtocolError(
        'PICOBOOT bulk endpoints not found. ' +
        'Is the device in BOOTSEL mode?'
      );
    }

    return new NodeUSBTransport(dev, iface, outEp, inEp);
  }

  // ── IPicobootTransport ─────────────────────────────────────────────────────

  async sendCommand(cmd: Uint8Array): Promise<void> {
    return this._transferOut(cmd);
  }

  async receiveBytes(maxLength: number): Promise<Uint8Array> {
    if (maxLength === 0) return new Uint8Array(0);
    return new Promise<Uint8Array>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.inEp as any).transfer(maxLength, (err: Error | null, data?: Buffer) => {
        if (err) reject(err);
        else resolve(data ? new Uint8Array(data) : new Uint8Array(0));
      });
    });
  }

  async sendBytes(data: Uint8Array): Promise<void> {
    return this._transferOut(data);
  }

  async resetInterface(): Promise<void> {
    // PICOBOOT_RESET control transfer (bmRequestType=0x41, bRequest=0x41)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dev   = this.device as any;
    const iface = this.iface  as any;
    return new Promise<void>((resolve, reject) => {
      dev.controlTransfer(
        0x41,                         // bmRequestType: host→device, class, interface
        0x41,                         // bRequest: PICOBOOT_RESET
        0,                            // wValue
        iface.interfaceNumber ?? 1,   // wIndex
        Buffer.alloc(0),
        (err: Error | null) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  async close(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await new Promise<void>((res) => (this.iface as any).release(true, () => res()));
    } catch { /* ignore */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.device as any).close();
    } catch { /* ignore */ }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _transferOut(data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.outEp as any).transfer(Buffer.from(data), (err: Error | null) => {
        if (err) reject(err); else resolve();
      });
    });
  }
}
