export interface FileUpload {
  body: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
}

export function multipartFileUpload(field: string, path: string, filename: string): FileUpload {
  const boundary = `----conveyor-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const safeName = filename.replace(/["\r\n]/g, "_");
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${safeName}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const file = Bun.file(path);
  const open = () => file.stream().getReader();
  let reader: ReturnType<typeof open> | undefined;
  let sentHead = false;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (!sentHead) {
          sentHead = true;
          controller.enqueue(head);
          return;
        }
        reader ??= open();
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        controller.enqueue(tail);
        controller.close();
      },
      async cancel(reason) {
        await reader?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return {
    body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(head.length + file.size + tail.length),
    },
  };
}
