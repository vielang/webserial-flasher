// USB transport abstraction for the PICOBOOT protocol (RP2040 / RP2350 BOOTSEL mode).
//
// PICOBOOT is a USB vendor-class bulk-transfer protocol exposed on interface 1
// of the RP2040 when held in BOOTSEL mode (VID=0x2E8A, PID=0x0003).
//
// Implementations:
//   NodeUSBTransport — Node.js, uses the 'usb' npm package (libusb)
//   (future) WebUSBTransport — browser, once RP2350 advertises WebUSB BOS descriptor

export interface IPicobootTransport {
  /**
   * Send a 32-byte PICOBOOT command packet to the USB OUT endpoint.
   * Must be called before any data phase.
   */
  sendCommand(cmd: Uint8Array): Promise<void>;

  /**
   * Read up to `maxLength` bytes from the USB IN endpoint.
   * Used for both data reads (READ command) and status responses.
   */
  receiveBytes(maxLength: number): Promise<Uint8Array>;

  /**
   * Send raw bytes to the USB OUT endpoint.
   * Used for the data phase of a WRITE command.
   */
  sendBytes(data: Uint8Array): Promise<void>;

  /**
   * Issue a USB control transfer to reset the PICOBOOT interface state machine.
   * Should be called before the first command to ensure a clean state.
   */
  resetInterface(): Promise<void>;

  /** Release the USB interface and close the device. */
  close(): Promise<void>;
}
