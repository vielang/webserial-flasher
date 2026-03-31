# webserial-flasher

A modern, ESM-compatible, TypeScript implementation of the STK500v1 protocol for programming Arduino boards directly from Node.js or the browser.

## Features

- Full JavaScript/TypeScript implementation of the STK500v1 programmer
- ESM (ECMAScript Modules) compatible
- Can be used in Node.js or browser environments
- No dependency on avrdude or the Arduino IDE
- TypeScript support for improved developer experience
- **Built-in Intel HEX parsing** (no need for external parsing libraries)

## Installation

```bash
npm install webserial-flasher
```

## Usage

Here's a basic example of how to use webserial-flasher to program an Arduino:

```typescript
import { SerialPort } from "serialport";
import fs from "fs/promises";
import STK500, { type Board } from "webserial-flasher";

const board: Board = {
  name: "Arduino Uno",
  baudRate: 115200,
  signature: new Uint8Array([0x1e, 0x95, 0x0f]),
  pageSize: 128,
  timeout: 400,
};

async function upload(path: string) {
  let serialPort;
  try {
    const hexData = await fs.readFile("path/to/your/sketch.hex");
    serialPort = new SerialPort({ path, baudRate: board.baudRate });
    const stk = new STK500(serialPort, board);
    await stk.bootload(hexData);
    console.log("Programming successful!");
  } catch (error) {
    console.error("Programming failed:", error);
  } finally {
    if (serialPort) {
      await serialPort.close();
    }
  }
}

upload("/dev/ttyACM0"); // Replace with your Arduino's serial port
```

## Examples

For more detailed examples, please check the `examples` folder in the repository. It contains several TypeScript files demonstrating how to use webserial-flasher with different Arduino boards:

- `avr4809.ts`: Example for AVR4809 based boards
- `diecimila-duemilanove168.ts`: Example for Arduino Diecimila and Duemilanove (ATmega168)
- `duemilanove328.ts`: Example for Arduino Duemilanove (ATmega328)
- `lg8f328.ts`: Example for LGT8F328 boards
- `nano.ts`: Example for Arduino Nano
- `uno.ts`: Example for Arduino Uno

These examples show how to set up the board configuration, read hex files, and upload them to the respective Arduino boards.

To run an example, use:

```bash
npx tsx examples/uno.ts /dev/ttyACM0
```

Replace `uno.ts` with the appropriate example file and `/dev/ttyACM0` with your Arduino's serial port.

## API

The main class `STK500` provides the following methods:

- `constructor(stream: Duplex, board: Board, opts?: STK500Options)`
- `bootload(hexData: string | Uint8Array, progressCallback?: BootloadProgressCallback): Promise<void>`
- `sync(attempts: number): Promise<Uint8Array>`
- `verifySignature(): Promise<Uint8Array>`
- `upload(hexData: string | Uint8Array, progressCallback?: (percentage: number) => void): Promise<void>`
- `verify(hexData: string | Uint8Array, progressCallback?: (percentage: number) => void): Promise<void>`

For more detailed API information, please refer to the TypeScript definitions or the source code.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
