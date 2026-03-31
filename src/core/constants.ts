// STK500v1 protocol constants — complete specification
// Reference: https://ww1.microchip.com/downloads/en/DeviceDoc/doc2525.pdf

const Resp_STK_INSYNC = 0x14;
const Resp_STK_OK     = 0x10;

const Constants = {
  // ── Handshake / Sync ──────────────────────────────────────────────────────
  Cmnd_STK_GET_SYNC:        0x30,
  Cmnd_STK_GET_SIGN_ON:     0x31,

  // ── Configuration ─────────────────────────────────────────────────────────
  Cmnd_STK_SET_PARAMETER:   0x40,
  Cmnd_STK_GET_PARAMETER:   0x41,
  Cmnd_STK_SET_DEVICE:      0x42,
  Cmnd_STK_SET_DEVICE_EXT:  0x45,

  // ── Programming Control ───────────────────────────────────────────────────
  Cmnd_STK_ENTER_PROGMODE:  0x50,
  Cmnd_STK_LEAVE_PROGMODE:  0x51,
  Cmnd_STK_CHIP_ERASE:      0x52,
  Cmnd_STK_CHECK_AUTOINC:   0x53,
  Cmnd_STK_LOAD_ADDRESS:    0x55,
  Cmnd_STK_UNIVERSAL:       0x56,
  Cmnd_STK_UNIVERSAL_MULTI: 0x57,

  // ── Write (Paged) ─────────────────────────────────────────────────────────
  Cmnd_STK_PROG_FLASH:      0x60,
  Cmnd_STK_PROG_DATA:       0x61,
  Cmnd_STK_PROG_FUSE:       0x62,
  Cmnd_STK_PROG_LOCK:       0x63,
  Cmnd_STK_PROG_PAGE:       0x64,
  Cmnd_STK_PROG_FUSE_EXT:   0x65,

  // ── Read ──────────────────────────────────────────────────────────────────
  Cmnd_STK_READ_FLASH:      0x70,
  Cmnd_STK_READ_DATA:       0x71,
  Cmnd_STK_READ_FUSE:       0x72,
  Cmnd_STK_READ_LOCK:       0x73,
  Cmnd_STK_READ_PAGE:       0x74,
  Cmnd_STK_READ_SIGN:       0x75,
  Cmnd_STK_READ_OSCCAL:     0x76,
  Cmnd_STK_READ_FUSE_EXT:   0x77,
  Cmnd_STK_READ_OSCCAL_EXT: 0x78,

  // ── Protocol Framing ──────────────────────────────────────────────────────
  Sync_CRC_EOP:             0x20, // Every command ends with this byte

  // ── Response Codes ────────────────────────────────────────────────────────
  Resp_STK_OK:              0x10,
  Resp_STK_FAILED:          0x11,
  Resp_STK_UNKNOWN:         0x12,
  Resp_STK_NODEVICE:        0x13,
  Resp_STK_INSYNC:          0x14,
  Resp_STK_NOSYNC:          0x15,

  Resp_ADC_CHANNEL_ERROR:   0x16,
  Resp_ADC_MEASURE_OK:      0x17,
  Resp_PWM_CHANNEL_ERROR:   0x18,
  Resp_PWM_ADJUST_OK:       0x19,

  // ── Convenience ───────────────────────────────────────────────────────────
  OK_RESPONSE: new Uint8Array([Resp_STK_INSYNC, Resp_STK_OK]),
} as const;

export default Constants;
