export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413) {
    super("Invalid request body");
  }
}
// Bound bytes during streaming, before allocating the full body or parsing JSON.
export async function readLimitedBody(
  request: Request,
  limit: number,
  timeoutMs = 10000,
) {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new RequestBodyError(400);
  if (length !== null && Number(length) > limit)
    throw new RequestBodyError(413);
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408)), timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RequestBodyError(413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error instanceof RequestBodyError ? error : new RequestBodyError(400);
  } finally {
    clearTimeout(timer);
  }
}
export function publicResponse(
  body: string,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      ...extra,
    },
  });
}
