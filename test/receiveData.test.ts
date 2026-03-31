import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Constants from "../src/lib/constants.js";
import receiveData from "../src/lib/receiveData.js";
import { Duplex } from "node:stream";

describe("receiveData", () => {
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

  test("should receive a matching buffer", async () => {
    const inputBuffer = Constants.OK_RESPONSE;
    stream.write(inputBuffer);
    const data = await receiveData(stream, 10, inputBuffer.length);
    assert(data.every((value, index) => value === inputBuffer[index]));
  });

  test("should timeout", async () => {
    const inputBuffer = Constants.OK_RESPONSE;
    stream.write(inputBuffer.subarray(0, 1));
    await assert.rejects(receiveData(stream, 10, inputBuffer.length), {
      message: "receiveData timeout after 10ms",
    });
  });

  test("should receive a buffer in chunks", async () => {
    const inputBuffer = Constants.OK_RESPONSE;
    stream.write(inputBuffer.subarray(0, 1));
    setTimeout(() => {
      stream.write(inputBuffer.subarray(1, 2));
    }, 5);
    const data = await receiveData(stream, 20, inputBuffer.length);
    assert(data.every((value, index) => value === inputBuffer[index]));
  });
});
