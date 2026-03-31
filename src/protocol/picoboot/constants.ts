// PICOBOOT USB protocol constants for RP2040 / RP2350
// Reference: https://github.com/raspberrypi/pico-sdk/blob/master/src/common/boot_picoboot_headers/include/boot/picoboot.h
//            https://github.com/raspberrypi/picotool/blob/master/picoboot_connection/picoboot_connection.h

// ── USB device identifiers ──────────────────────────────────────────────────

/** Raspberry Pi USB Vendor ID */
export const PICOBOOT_VID = 0x2E8A;
/** RP2040 USBBOOT Product ID (BOOTSEL mode) */
export const PICOBOOT_PID_RP2040 = 0x0003;
/** RP2350 USBBOOT Product ID (BOOTSEL mode) */
export const PICOBOOT_PID_RP2350 = 0x000F;

// ── USB interface / endpoint layout ────────────────────────────────────────
// Interface 0 = MSD (Mass Storage, virtual FAT drive for UF2 drag-and-drop)
// Interface 1 = PICOBOOT (vendor class 0xFF, binary protocol)

/** PICOBOOT interface index (interface 1) */
export const PICOBOOT_INTERFACE = 1;

// ── PICOBOOT command frame ──────────────────────────────────────────────────

/** Magic number at offset 0 of every PICOBOOT command packet (little-endian) */
export const PICOBOOT_MAGIC = 0x431FD10B;

/** Size of a PICOBOOT command packet in bytes */
export const PICOBOOT_CMD_SIZE = 32;

/** Size of the PICOBOOT status response in bytes */
export const PICOBOOT_STATUS_SIZE = 16;

// ── PICOBOOT command IDs ────────────────────────────────────────────────────
// Bit 7 = 1 means data flows IN (device → host). Bit 7 = 0 means OUT.

export const PicobootCmd = {
  EXCLUSIVE_ACCESS: 0x01,  // OUT, args: 1-byte exclusive flag
  REBOOT:           0x02,  // OUT, args: [PC u32][SP u32][delayMs u32]
  FLASH_ERASE:      0x03,  // OUT, args: [addr u32][size u32], no data phase
  READ:             0x84,  // IN  (bit7 set), args: [addr u32][size u32]
  WRITE:            0x05,  // OUT, args: [addr u32][size u32]
  EXIT_XIP:         0x06,  // OUT, no args
  ENTER_CMD_XIP:    0x07,  // OUT, no args
  EXEC:             0x08,  // OUT, args: [addr u32]
  VECTORIZE_FLASH:  0x09,  // OUT, args: [addr u32]
} as const;

// ── PICOBOOT status codes ───────────────────────────────────────────────────

export const PicobootStatus = {
  OK:              0,
  UNKNOWN_CMD:     1,
  BAD_CHECKSUM:    2,
  NOT_PERMITTED:   3,
  INVALID_ADDRESS: 4,
  BAD_ALIGNMENT:   5,
  INTERLEAVED:     6,
  REBOOTING:       7,
  UNKNOWN:         8,
  INVALID_STATE:   9,
} as const;

// ── Flash geometry ──────────────────────────────────────────────────────────

/** Minimum erase granularity — address and size must be 4KB-aligned */
export const FLASH_SECTOR_SIZE = 4096;

/** Flash page write size — address and size must be 256-byte-aligned */
export const FLASH_PAGE_SIZE = 256;

/** XIP base address in CPU address space (flash starts here for the CPU) */
export const RP2040_FLASH_BASE = 0x10000000;

/**
 * PICOBOOT uses offset-0 addressing for flash.
 * To write to XIP address 0x10001000, pass addr = 0x00001000.
 * Use this mask to convert: picobootAddr = xipAddr & ~RP2040_FLASH_BASE
 */
export const RP2040_FLASH_ADDR_MASK = 0x0FFFFFFF;

// ── UF2 file format ─────────────────────────────────────────────────────────
// Reference: https://github.com/microsoft/uf2

export const UF2_MAGIC_START0   = 0x0A324655;  // "UF2\n" bytes
export const UF2_MAGIC_START1   = 0x9E5D5157;
export const UF2_MAGIC_END      = 0x0AB16F30;

/** UF2 flag: familyID field is valid (must be set for RP2040/RP2350) */
export const UF2_FLAG_FAMILY_ID = 0x00002000;
/** UF2 flag: block should not be flashed (skip when flashing) */
export const UF2_FLAG_NOT_MAIN  = 0x00000001;

/** Total size of one UF2 block (bytes) */
export const UF2_BLOCK_SIZE     = 512;
/** Usable payload bytes per UF2 block */
export const UF2_PAYLOAD_SIZE   = 256;

// ── UF2 family IDs ──────────────────────────────────────────────────────────

export const UF2_FAMILY_RP2040       = 0xE48BFF56;
export const UF2_FAMILY_RP2350_ARM   = 0xE48BFF59;  // Secure ARM
export const UF2_FAMILY_RP2350_RISCV = 0xE48BFF5A;
export const UF2_FAMILY_RP2350_ARM_NS = 0xE48BFF5B; // Non-secure ARM
