import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import Constants from "../src/lib/constants.js";
import sendCommand from "../src/lib/sendCommand.js";

describe("sendCommands", () => {
  let stream: Duplex;

  beforeEach(() => {
    stream = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        this.push(chunk);
        callback();
      },
    });
  });

  afterEach(() => {
    (stream as Duplex).removeAllListeners();
  });

  test("should write a Uint8Array command", async () => {
    const cmd = new Uint8Array([
      Constants.Cmnd_STK_GET_SYNC,
      Constants.Sync_CRC_EOP,
    ]);
    const opt = {
      cmd: cmd,
      responseData: Constants.OK_RESPONSE,
      timeout: 10,
    };

    let writeCalled = false;
    const originalWrite = stream.write;
    stream.write = (chunk: any, encoding?: any, callback?: any) => {
      writeCalled = true;
      assert(
        chunk instanceof Uint8Array &&
          chunk.every((value, index) => value === cmd[index])
      );
      return originalWrite.call(stream, chunk, encoding, callback);
    };

    setTimeout(() => {
      stream.push(Constants.OK_RESPONSE);
    }, 0);

    const data = await sendCommand(stream, opt);
    assert(writeCalled);
    assert(
      data.every((value, index) => value === Constants.OK_RESPONSE[index])
    );
  });

  test("should write an array command", async () => {
    const opt = {
      cmd: [Constants.Cmnd_STK_GET_SYNC],
      responseData: Constants.OK_RESPONSE,
      timeout: 10,
    };

    let writeCalled = false;
    const originalWrite = stream.write;
    stream.write = (chunk: any, encoding?: any, callback?: any) => {
      writeCalled = true;
      assert(
        chunk instanceof Uint8Array &&
          chunk.every(
            (value, index) =>
              value ===
              new Uint8Array([
                Constants.Cmnd_STK_GET_SYNC,
                Constants.Sync_CRC_EOP,
              ])[index]
          )
      );
      return originalWrite.call(stream, chunk, encoding, callback);
    };

    setTimeout(() => {
      stream.push(Constants.OK_RESPONSE);
    }, 0);

    const data = await sendCommand(stream, opt);
    assert(writeCalled);
    assert(
      data.every((value, index) => value === Constants.OK_RESPONSE[index])
    );
  });

  test("should timeout", async () => {
    const opt = {
      cmd: [Constants.Cmnd_STK_GET_SYNC],
      responseData: Constants.OK_RESPONSE,
      timeout: 10,
    };

    await assert.rejects(sendCommand(stream, opt), {
      message: "Sending 3020: receiveData timeout after 10ms",
    });
  });

  test("should get n number of bytes", async () => {
    const opt = {
      cmd: [Constants.Cmnd_STK_GET_SYNC],
      responseLength: 2,
      timeout: 10,
    };

    setTimeout(() => {
      stream.push(Constants.OK_RESPONSE);
    }, 0);

    const data = await sendCommand(stream, opt);
    assert(
      data.every((value, index) => value === Constants.OK_RESPONSE[index])
    );
  });

  test("should match response", async () => {
    const opt = {
      cmd: [Constants.Cmnd_STK_GET_SYNC],
      responseData: Constants.OK_RESPONSE,
      timeout: 10,
    };

    setTimeout(() => {
      stream.push(Constants.OK_RESPONSE);
    }, 0);

    const data = await sendCommand(stream, opt);
    assert(
      data.every((value, index) => value === Constants.OK_RESPONSE[index])
    );
  });
});
