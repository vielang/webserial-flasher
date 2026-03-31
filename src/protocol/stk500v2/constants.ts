// STK500v2 protocol constants.
// Used by the wiring/ISP bootloader (Arduino Mega 2560, STK600, etc.)
// Reference: Atmel Application Note AVR068 — STK500 Communication Protocol

/** Frame delimiter — every message starts with this byte */
export const MSG_START = 0x1B;
/** Token — separates the 4-byte header from the message body */
export const MSG_TOKEN = 0x0E;

/** Command bytes sent by the master (programmer) */
export const Cmd = {
  // ── General ────────────────────────────────────────────────────────────
  SIGN_ON:                  0x01,
  SET_PARAMETER:            0x02,
  GET_PARAMETER:            0x03,
  SET_DEVICE_DESCRIPTOR:    0x04,
  OSCCAL:                   0x05,
  LOAD_ADDRESS:             0x06,
  FIRMWARE_UPGRADE:         0x07,

  // ── ISP programming ────────────────────────────────────────────────────
  ENTER_PROGMODE_ISP:       0x10,
  LEAVE_PROGMODE_ISP:       0x11,
  CHIP_ERASE_ISP:           0x12,
  PROGRAM_FLASH_ISP:        0x13,
  READ_FLASH_ISP:           0x14,
  PROGRAM_EEPROM_ISP:       0x15,
  READ_EEPROM_ISP:          0x16,
  PROGRAM_FUSE_ISP:         0x17,
  READ_FUSE_ISP:            0x18,
  PROGRAM_LOCK_ISP:         0x19,
  READ_LOCK_ISP:            0x1A,
  READ_SIGNATURE_ISP:       0x1B,
  READ_OSCCAL_ISP:          0x1C,
  SPI_MULTI:                0x1D,
} as const;

/** Status codes returned in response bodies */
export const Status = {
  CMD_OK:            0x00,
  CMD_TOUT:          0x80,  // Timeout
  RDY_BSY_TOUT:      0x81,  // Ready/busy timeout
  SET_PARAM_MISSING: 0x82,
  CMD_FAILED:        0xC0,
  CMD_UNKNOWN:       0xC9,
  ISP_READY:         0x00,  // Alias for CMD_OK in ISP context
} as const;

/** Programmer parameter IDs (used with SET/GET_PARAMETER) */
export const Param = {
  BUILD_NUMBER_LOW:   0x80,
  BUILD_NUMBER_HIGH:  0x81,
  HW_VER:             0x90,
  SW_MAJOR:           0x91,
  SW_MINOR:           0x92,
  VTARGET:            0x94,
  VADJUST:            0x95,
  OSC_PSCALE:         0x96,
  OSC_CMATCH:         0x97,
  SCK_DURATION:       0x98,
  TOPCARD_DETECT:     0x9A,
  STATUS:             0x9C,
  DATA:               0x9D,
  RESET_POLARITY:     0x9E,
  CONTROLLER_INIT:    0x9F,
} as const;
