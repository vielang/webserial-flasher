// UPDI (Unified Program and Debug Interface) protocol constants.
// Covers tinyAVR 0/1/2 series, megaAVR 0 series (ATmega4809).
// Reference: AVR® DA/DB Device Series Datasheet (Microchip Technology)
//            Atmel ATtiny1614/16/17 datasheet — UPDI chapter

// ── Physical layer ───────────────────────────────────────────────────────────

/** UPDI synchronisation byte — sent before every instruction */
export const UPDI_SYNC = 0x55;

/** ACK byte returned by device for write operations */
export const UPDI_ACK  = 0x40;

// ── Instruction opcodes (bits 7:5) ────────────────────────────────────────────

/** LDS — Load from Data Space (followed by address + returns data) */
export const UPDI_LDS    = 0x00;
/** STS — Store to Data Space (followed by address + data) */
export const UPDI_STS    = 0x40;
/** LD  — Load indirect (uses pointer register) */
export const UPDI_LD     = 0x20;
/** ST  — Store indirect (uses pointer register) */
export const UPDI_ST     = 0x60;
/** LDCS — Load from Control/Status Space */
export const UPDI_LDCS   = 0x80;
/** STCS — Store to Control/Status Space */
export const UPDI_STCS   = 0xC0;
/** REPEAT — Repeat the next instruction N+1 times */
export const UPDI_REPEAT = 0xA0;
/** KEY  — Key broadcast (8 or 16 bytes) */
export const UPDI_KEY    = 0xE0;

// ── Address/data size operands ────────────────────────────────────────────────

/** Address operand: 1-byte address */
export const UPDI_ADDRESS_8  = 0;
/** Address operand: 2-byte address (default for all AVR NVM access) */
export const UPDI_ADDRESS_16 = 1;
/** Address operand: 3-byte address (AVR DA/DB extended addressing) */
export const UPDI_ADDRESS_24 = 2;

/** Data operand: 1-byte data */
export const UPDI_DATA_8  = 0;
/** Data operand: 2-byte data */
export const UPDI_DATA_16 = 1;

// ── Pointer modes (bits 4:2 for LD/ST instructions) ──────────────────────────

/** Pointer mode: access *(ptr) */
export const UPDI_PTR     = 0;
/** Pointer mode: access *(ptr++) — post-increment */
export const UPDI_PTR_INC = 1;
/** Pointer mode: access *(--ptr) — pre-decrement */
export const UPDI_PTR_DEC = 2;

// ── Key sizes (bits 1:0 of KEY instruction) ──────────────────────────────────

/** 8-byte (64-bit) key */
export const UPDI_KEY_SIZE_64  = 0;
/** 16-byte (128-bit) key */
export const UPDI_KEY_SIZE_128 = 1;

// ── Control/Status register addresses ────────────────────────────────────────

export const UPDI_CS_STATUSA         = 0x00;
export const UPDI_CS_STATUSB         = 0x01;
export const UPDI_CS_CTRLA           = 0x02;
export const UPDI_CS_CTRLB           = 0x03;
/** ASI_KEY_STATUS — shows which key is currently active */
export const UPDI_CS_ASI_KEY_STATUS  = 0x07;
/** ASI_RESET_REQ  — write 0x59 to assert reset, 0x00 to deassert */
export const UPDI_CS_ASI_RESET_REQ   = 0x08;
export const UPDI_CS_ASI_CTRL_A      = 0x09;
export const UPDI_CS_ASI_SYS_CTRLA   = 0x0A;
/** ASI_SYS_STATUS — NVMPROG / LOCKSTATUS / UROWPROG bits */
export const UPDI_CS_ASI_SYS_STATUS  = 0x0B;

// ── CTRLA bits ───────────────────────────────────────────────────────────────

/** Guard-time insertion delay (IBDLY) */
export const UPDI_CTRLA_IBDLY  = 0x80;
/** Guard-time value: 2-cycle inter-byte delay (minimises wait between bytes) */
export const UPDI_CTRLA_GT_2   = 0x06;

// ── ASI_KEY_STATUS bits ───────────────────────────────────────────────────────

export const UPDI_KEY_CHIPERASE = 0x08;
export const UPDI_KEY_NVMPROG   = 0x10;
export const UPDI_KEY_UROWWRITE = 0x20;

// ── ASI_SYS_STATUS bits ───────────────────────────────────────────────────────

export const UPDI_SYS_RSTSYS     = 0x20;
export const UPDI_SYS_INSLEEP    = 0x10;
export const UPDI_SYS_NVMPROG    = 0x08;
export const UPDI_SYS_UROWPROG   = 0x04;
export const UPDI_SYS_LOCKSTATUS = 0x01;

// ── Reset request byte ────────────────────────────────────────────────────────

export const UPDI_RESET_REQ_ASSERT   = 0x59;
export const UPDI_RESET_REQ_DEASSERT = 0x00;

// ── NVM Controller (NVMv0 — tinyAVR 0/1/2, megaAVR 0) ───────────────────────

export const NVM_BASE    = 0x1000;
export const NVM_CTRLA   = 0x1000;
export const NVM_CTRLB   = 0x1001;
export const NVM_STATUS  = 0x1002;
export const NVM_INTCTRL = 0x1003;
export const NVM_INTFLAGS= 0x1004;
export const NVM_DATA    = 0x1006;
export const NVM_ADDR    = 0x1008;  // 16-bit address register

// ── NVM status bits ───────────────────────────────────────────────────────────

/** Flash busy — poll until cleared after write/erase */
export const NVM_FBUSY  = 0x01;
/** EEPROM busy */
export const NVM_EEBUSY = 0x02;
/** Write error */
export const NVM_WRERR  = 0x04;

// ── NVM commands (write to NVM_CTRLA) ────────────────────────────────────────

export const NVM_CMD_NOP  = 0x00;  // No operation (clear previous command)
export const NVM_CMD_WP   = 0x01;  // Write page (from buffer)
export const NVM_CMD_ER   = 0x02;  // Erase page
export const NVM_CMD_ERWP = 0x03;  // Erase and write page (most common for flash)
export const NVM_CMD_PBC  = 0x04;  // Page buffer clear
export const NVM_CMD_CHER = 0x05;  // Chip erase (clears flash + EEPROM + fuses to reset values)
export const NVM_CMD_EEER = 0x06;  // EEPROM only erase
export const NVM_CMD_WFU  = 0x07;  // Write fuse

// ── SIGROW (signature row) ────────────────────────────────────────────────────

/** Default SIGROW base address — contains 3-byte device ID at offset 0 */
export const SIGROW_BASE          = 0x1100;
/** EEPROM base address (tinyAVR 0/1/2 and megaAVR 0) */
export const EEPROM_BASE          = 0x1400;
/** Fuse register base (tinyAVR 0/1/2) */
export const FUSE_BASE            = 0x1280;
/** Number of fuse registers */
export const FUSE_COUNT           = 6;

// ── Authentication keys (8 bytes, LSB-first as sent on the wire) ─────────────

/**
 * NVMProg key — grants access to NVM controller for flash/EEPROM/fuse writes.
 * ASCII: "NVMProg " reversed to [0x20, 0x67, 0x6F, 0x72, 0x50, 0x4D, 0x56, 0x4E]
 */
export const UPDI_KEY_NVM_PROG: Uint8Array = new Uint8Array([
  0x20, 0x67, 0x6F, 0x72, 0x50, 0x4D, 0x56, 0x4E,
]);

/**
 * ChipErase key — grants a single chip erase operation even on a locked device.
 * ASCII: "NVMErase" reversed
 */
export const UPDI_KEY_CHIP_ERASE_REQ: Uint8Array = new Uint8Array([
  0x65, 0x73, 0x61, 0x72, 0x45, 0x4D, 0x56, 0x4E,
]);
