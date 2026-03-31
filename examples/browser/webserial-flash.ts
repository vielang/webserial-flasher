/**
 * Example: Flash Arduino Uno from the browser via WebSerial API
 *
 * Requirements: Chrome 89+ or Edge 89+ (not Firefox/Safari)
 * Bundle with: esbuild, Vite, or any modern bundler
 *
 * This file shows the complete integration pattern for a browser UI.
 */

import STK500, {
  WebSerialTransport,
  BOARDS,
  boardFromFqbn,
  ARDUINO_USB_VENDOR_IDS,
  STK500SyncError,
  STK500SignatureMismatchError,
  STK500VerifyError,
  type Board,
} from '../../src/index.js';

// ── State types ─────────────────────────────────────────────────────────────

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
  hint:          string | null; // troubleshooting tip
}

// ── Flash function ───────────────────────────────────────────────────────────

/**
 * Flash a compiled HEX string to a connected Arduino board.
 *
 * @param hexString  Intel HEX content (from backend compile endpoint)
 * @param boardFqbn  arduino-cli FQBN string, e.g. 'arduino:avr:uno'
 * @param onState    callback for state updates (progress, errors, etc.)
 */
export async function flashToDevice(
  hexString: string,
  boardFqbn: string,
  onState: (state: FlashState) => void
): Promise<void> {
  const setState = (partial: Partial<FlashState>): void => {
    onState({ status: 'idle', progress: 0, progressLabel: '', error: null, hint: null, ...partial });
  };

  if (!WebSerialTransport.isSupported()) {
    setState({
      status: 'error',
      error:  'WebSerial is not supported in this browser.',
      hint:   'Use Chrome 89+ or Edge 89+.',
    });
    return;
  }

  // Resolve board config from FQBN (falls back to Arduino Uno)
  const board: Board = boardFromFqbn(boardFqbn) ?? BOARDS['arduino-uno'];

  let transport: WebSerialTransport | null = null;

  try {
    // Step 1: Prompt user to select a port
    setState({ status: 'requesting-port', progressLabel: 'Waiting for port selection...' });

    try {
      transport = await WebSerialTransport.requestPort(
        ARDUINO_USB_VENDOR_IDS.map((id) => ({ usbVendorId: id }))
      );
    } catch (err: unknown) {
      // User cancelled the port picker
      const name = err instanceof Error ? (err as { name?: string }).name : '';
      if (name === 'NotFoundError' || name === 'SecurityError') {
        setState({ status: 'idle' }); // Not an error — user just closed the dialog
        return;
      }
      throw err;
    }

    // Step 2: Open port
    setState({ status: 'connecting', progressLabel: `Opening at ${board.baudRate} baud...` });
    await transport.open(board.baudRate);

    // Step 3: Flash
    setState({ status: 'flashing', progress: 0, progressLabel: 'Starting...' });

    const stk = new STK500(transport, board, {
      quiet: false,
      logger: (_level, msg) => console.debug('[stk500]', msg),
      retry: { syncAttempts: 5, retryDelayMs: 200 },
    });

    await stk.bootload(hexString, (label, pct) => {
      setState({
        status:        'flashing',
        progress:      Math.round(pct),
        progressLabel: label,
      });
    });

    setState({ status: 'success', progress: 100, progressLabel: 'Flash complete!' });

  } catch (err: unknown) {
    let error = err instanceof Error ? err.message : String(err);
    let hint: string | null = null;

    if (err instanceof STK500SyncError) {
      hint =
        'Press the Reset button on the Arduino just before clicking Flash, ' +
        'or check that the correct board type is selected.';
    } else if (err instanceof STK500SignatureMismatchError) {
      hint = `Wrong board selected. Detected chip signature: ` +
        Array.from(err.actual).map((b) => `0x${b.toString(16)}`).join(', ');
    } else if (err instanceof STK500VerifyError) {
      hint = 'Flash verification failed — the data written to the chip does not match. ' +
        'Try reflashing or check for a noisy USB connection.';
    }

    setState({ status: 'error', error, hint });

  } finally {
    await transport?.close();
  }
}
