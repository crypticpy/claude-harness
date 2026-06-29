import { describe, it, expect } from "vitest";
import { encodeMessage, MessageBuffer } from "../src/lsp/protocol";

describe("encodeMessage", () => {
  it("frames a message with a byte-accurate Content-Length header", () => {
    const buf = encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
    const text = buf.toString("utf8");
    const [header, body] = text.split("\r\n\r\n");
    const len = Number(/Content-Length:\s*(\d+)/.exec(header)![1]);
    expect(Buffer.byteLength(body, "utf8")).toBe(len);
    expect(JSON.parse(body)).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });

  it("counts bytes, not characters, for multibyte bodies", () => {
    const buf = encodeMessage({
      jsonrpc: "2.0",
      method: "m",
      params: { s: "café→λ" },
    });
    const text = buf.toString("utf8");
    const header = text.slice(0, text.indexOf("\r\n\r\n"));
    const len = Number(/Content-Length:\s*(\d+)/.exec(header)![1]);
    const body = buf.subarray(buf.indexOf(Buffer.from("\r\n\r\n")) + 4);
    expect(body.length).toBe(len);
  });
});

describe("MessageBuffer", () => {
  it("decodes a single complete frame", () => {
    const mb = new MessageBuffer();
    const msgs = mb.append(
      encodeMessage({ jsonrpc: "2.0", id: 1, result: "ok" }),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ id: 1, result: "ok" });
    expect(mb.pending).toBe(0);
  });

  it("decodes multiple frames in one chunk", () => {
    const mb = new MessageBuffer();
    const chunk = Buffer.concat([
      encodeMessage({ jsonrpc: "2.0", id: 1, result: "a" }),
      encodeMessage({ jsonrpc: "2.0", id: 2, result: "b" }),
    ]);
    const msgs = mb.append(chunk);
    expect(msgs.map((m) => m.id)).toEqual([1, 2]);
  });

  it("reassembles a frame split across chunk boundaries", () => {
    const mb = new MessageBuffer();
    const full = encodeMessage({ jsonrpc: "2.0", id: 7, method: "split" });
    const cut = Math.floor(full.length / 2);
    expect(mb.append(full.subarray(0, cut))).toHaveLength(0);
    expect(mb.pending).toBeGreaterThan(0);
    const msgs = mb.append(full.subarray(cut));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ id: 7, method: "split" });
  });

  it("splits the header across a chunk boundary", () => {
    const mb = new MessageBuffer();
    const full = encodeMessage({ jsonrpc: "2.0", id: 3, result: 1 });
    // Cut inside the header (before the \r\n\r\n separator).
    expect(mb.append(full.subarray(0, 5))).toHaveLength(0);
    const msgs = mb.append(full.subarray(5));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(3);
  });

  it("skips a malformed JSON body without wedging the stream", () => {
    const mb = new MessageBuffer();
    const badBody = Buffer.from("{not json", "utf8");
    const bad = Buffer.concat([
      Buffer.from(`Content-Length: ${badBody.length}\r\n\r\n`, "ascii"),
      badBody,
    ]);
    const good = encodeMessage({ jsonrpc: "2.0", id: 99, result: "after" });
    const msgs = mb.append(Buffer.concat([bad, good]));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(99);
  });

  it("resyncs past an unparseable header", () => {
    const mb = new MessageBuffer();
    const junk = Buffer.from("garbage-no-length\r\n\r\n", "ascii");
    const good = encodeMessage({ jsonrpc: "2.0", id: 42, result: "ok" });
    const msgs = mb.append(Buffer.concat([junk, good]));
    expect(msgs.map((m) => m.id)).toEqual([42]);
  });
});
