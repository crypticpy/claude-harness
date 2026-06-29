/**
 * LSP wire protocol — JSON-RPC over `Content-Length`-framed streams.
 *
 * Pure and stream-agnostic so it can be unit-tested without spawning a server:
 *   encodeMessage(obj) -> Buffer ready to write to a server's stdin
 *   new MessageBuffer().append(chunk) -> parsed messages decoded so far
 */

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Frame a JSON-RPC message with the LSP `Content-Length` header. */
export function encodeMessage(msg: object): Buffer {
  const json = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, json]);
}

/**
 * Incremental decoder. Feed it raw stdout chunks; it returns whole messages as
 * they complete, buffering partial frames across chunk boundaries. Malformed
 * JSON bodies are skipped (not thrown) so one bad frame can't wedge the stream.
 */
export class MessageBuffer {
  private buf: Buffer = Buffer.alloc(0);

  append(chunk: Buffer): JsonRpcMessage[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: JsonRpcMessage[] = [];

    for (;;) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break; // header not fully received yet

      const header = this.buf.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Unparseable header — discard through the separator and resync.
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }

      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + length) break; // body incomplete

      const body = this.buf
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.buf = this.buf.subarray(bodyStart + length);

      try {
        out.push(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Skip a malformed body; framing has already advanced past it.
      }
    }

    return out;
  }

  /** Bytes buffered but not yet consumed (for diagnostics/tests). */
  get pending(): number {
    return this.buf.length;
  }
}
