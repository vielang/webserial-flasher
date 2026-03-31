import fs from "fs/promises";
import { SerialPort } from "serialport";
import STK500, { type Board } from "../src/index.js";

const board: Board = {
  name: "Duemilanove 328",
  baudRate: 57600,
  signature: new Uint8Array([0x1e, 0x95, 0x0f]),
  pageSize: 128,
  timeout: 400,
};

function createSerialPort(path: string, baudRate: number): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const serialPort = new SerialPort({ path, baudRate });
    serialPort.on("open", () => resolve(serialPort));
    serialPort.on("error", reject);
  });
}

async function closeSerialPort(serialPort: SerialPort): Promise<void> {
  return new Promise((resolve) => {
    serialPort.close((error) => {
      if (error) console.log(error);
      resolve();
    });
  });
}

async function upload(path) {
  let serialPort: SerialPort | undefined;
  try {
    const hex = await fs.readFile("arduino-1.0.6/duemilanove328/StandardFirmata.cpp.hex");
    serialPort = await createSerialPort(path, board.baudRate);
    const stk = new STK500(serialPort, board);
    await stk.bootload(hex);
    console.log("Programming SUCCESS!");
  } catch (error) {
    console.error("Programming failed:", error);
  } finally {
    if (serialPort) {
      await closeSerialPort(serialPort);
    }
  }
}

async function main() {
  if (process.argv[2]) {
    await upload(process.argv[2]);
  } else {
    console.log("Call with a path like /dev/tty.something");
  }
  process.exit(0);
}

main().catch(console.error);
