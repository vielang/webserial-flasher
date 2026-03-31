/**
 * Flash Arduino / AVR boards from the browser using the WebSerial API.
 *
 * Browser support: Chrome 89+, Edge 89+
 * (Firefox and Safari do NOT support WebSerial)
 *
 * Bundle with: Vite, esbuild, Webpack, or any modern bundler.
 *
 * This example provides two things:
 *  1. A `flashToDevice()` function you can integrate into any framework (React, Vue, Svelte…)
 *  2. A standalone minimal HTML demo at the bottom
 *
 * Supported protocols:
 *  - STK500v1  → Arduino Uno, Nano, Pro Mini, …
 *  - STK500v2  → Arduino Mega 2560
 *  - AVR109    → Arduino Leonardo, Micro, Pro Micro
 */

import {
  STK500,
  STK500v2,
  AVR109,
  WebSerialTransport,
  BOARDS,
  ARDUINO_USB_VENDOR_IDS,
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  type Board,
} from 'webserial-flasher';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlashStatus =
  | 'idle'
  | 'requesting-port'
  | 'connecting'
  | 'flashing'
  | 'success'
  | 'error';

export interface FlashState {
  status:        FlashStatus;
  progress:      number;       // 0–100
  progressLabel: string;
  error:         string | null;
  hint:          string | null; // troubleshooting tip for the user
}

// ── Core flash function ───────────────────────────────────────────────────────

/**
 * Flash compiled firmware to a connected Arduino / AVR board.
 *
 * @param hexString  Intel HEX content as a string
 * @param board      Board config from BOARDS database or boardFromFqbn()
 * @param onState    Called on every state change (use to update your UI)
 *
 * @example
 *   const board = BOARDS['arduino-uno']!;
 *   await flashToDevice(hexString, board, (state) => {
 *     progressBar.value = state.progress;
 *     statusLabel.textContent = state.progressLabel;
 *   });
 */
export async function flashToDevice(
  hexString: string,
  board: Board,
  onState: (state: FlashState) => void,
): Promise<void> {
  const setState = (partial: Partial<FlashState>): void => {
    onState({
      status: 'idle', progress: 0, progressLabel: '',
      error: null, hint: null,
      ...partial,
    });
  };

  if (!WebSerialTransport.isSupported()) {
    setState({
      status: 'error',
      error:  'WebSerial is not supported in this browser.',
      hint:   'Use Chrome 89+ or Edge 89+. Firefox and Safari are not supported.',
    });
    return;
  }

  const transport = new WebSerialTransport();

  try {
    // Step 1: Prompt user to select a serial port
    setState({ status: 'requesting-port', progressLabel: 'Select a port…' });

    try {
      await transport.requestPort(
        ARDUINO_USB_VENDOR_IDS.map((id) => ({ usbVendorId: id }))
      );
    } catch (err) {
      // User cancelled the port picker — not an error
      const name = err instanceof Error ? (err as { name?: string }).name : '';
      if (name === 'NotFoundError' || name === 'SecurityError') {
        setState({ status: 'idle' });
        return;
      }
      throw err;
    }

    // Step 2: Open the port
    setState({ status: 'connecting', progressLabel: `Connecting at ${board.baudRate} baud…` });
    await transport.open(board.baudRate);

    // Step 3: Flash firmware
    setState({ status: 'flashing', progress: 0, progressLabel: 'Starting…' });

    const onProgress = (label: string, pct: number): void => {
      setState({ status: 'flashing', progress: pct, progressLabel: label });
    };

    switch (board.protocol) {
      case 'stk500v2': {
        const prog = new STK500v2(transport, board, { retry: { syncAttempts: 5 } });
        await prog.bootload(hexString, onProgress);
        break;
      }
      case 'avr109': {
        const prog = new AVR109(transport, board, { retry: { syncAttempts: 5 } });
        await prog.bootload(hexString, onProgress);
        break;
      }
      default: {
        const prog = new STK500(transport, board, { retry: { syncAttempts: 5 } });
        await prog.bootload(hexString, onProgress);
      }
    }

    setState({ status: 'success', progress: 100, progressLabel: '✓ Flash complete!' });

  } catch (err) {
    let error = err instanceof Error ? err.message : String(err);
    let hint: string | null = null;

    if (err instanceof STK500SyncError) {
      hint =
        'Could not sync with the board. Try:\n' +
        '• Press the Reset button just before clicking Flash\n' +
        '• Check that the correct board type is selected\n' +
        '• Verify the USB cable and port';
    } else if (err instanceof STK500SignatureMismatchError) {
      const actual = Array.from(err.actual).map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ');
      hint = `Wrong board type selected. Chip returned signature: ${actual}`;
    } else if (err instanceof STK500VerifyError) {
      hint =
        `Verify mismatch at address 0x${err.address.toString(16)}: ` +
        `expected 0x${err.expected.toString(16)}, got 0x${err.actual.toString(16)}.\n` +
        'Try reflashing — the USB connection may be noisy.';
    }

    setState({ status: 'error', error, hint });
  } finally {
    await transport.close();
  }
}

// ── Standalone minimal demo (no framework needed) ─────────────────────────────
// Wire up to HTML:
//   <input type="file" id="hex-file" accept=".hex" />
//   <select id="board-select"></select>
//   <button id="flash-btn">Flash</button>
//   <progress id="progress" max="100" value="0"></progress>
//   <div id="status"></div>

export function initDemo(): void {
  const fileInput   = document.getElementById('hex-file')     as HTMLInputElement;
  const boardSelect = document.getElementById('board-select')  as HTMLSelectElement;
  const flashBtn    = document.getElementById('flash-btn')     as HTMLButtonElement;
  const progressEl  = document.getElementById('progress')      as HTMLProgressElement;
  const statusEl    = document.getElementById('status')        as HTMLDivElement;

  // Populate board dropdown (serial protocols only — PICOBOOT uses USB not WebSerial)
  const serialProtocols = new Set(['stk500v1', 'stk500v2', 'avr109', undefined]);
  for (const [id, board] of Object.entries(BOARDS)) {
    if (!serialProtocols.has(board.protocol)) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.text  = board.name;
    boardSelect.appendChild(opt);
  }

  flashBtn.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) { alert('Select a .hex file first'); return; }

    const board = BOARDS[boardSelect.value] as Board | undefined;
    if (!board) { alert('Select a board'); return; }

    const hexString = await file.text();
    flashBtn.disabled = true;

    await flashToDevice(hexString, board, (state) => {
      progressEl.value     = state.progress;
      statusEl.textContent =
        state.error
          ? `Error: ${state.error}${state.hint ? '\n' + state.hint : ''}`
          : state.progressLabel;
    });

    flashBtn.disabled = false;
  });
}
