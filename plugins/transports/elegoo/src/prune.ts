import { filesToPrune, StageError } from "@conveyor/shared";
import { z } from "zod";
import { elegooState, elegooStatusOnce, READY_TIMEOUT_MS } from "./ready.js";
import { SDCP_CMD } from "./sdcp.js";
import { sendCommand } from "./socket.js";

const FOLDER = 0;

const FileListReply = z.object({
  FileList: z.array(z.object({ name: z.string(), type: z.number().optional() })),
});

const DeleteReply = z.object({ ErrData: z.array(z.string()).optional() });

async function printingFile(
  address: string,
  mainboardId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const push = await elegooStatusOnce(address, mainboardId, READY_TIMEOUT_MS, signal);
  if (push.kind === "error")
    throw new StageError("transport", `elegoo reported SDCP error ${push.errorCode}`);
  const state = elegooState(push.status);
  if (state === "unknown") throw new StageError("transport", "elegoo gave no usable state");
  if (state !== "idle" && !push.status.filename)
    throw new StageError("transport", `elegoo is ${state} but names no file`);
  return push.status.filename;
}

export async function pruneLocalFiles(
  address: string,
  mainboardId: string,
  keep: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<string[]> {
  const printing = await printingFile(address, mainboardId, signal);
  const listing = await sendCommand(
    address,
    { mainboardId, cmd: SDCP_CMD.FILE_LIST, data: { Url: "/local" } },
    true,
  );
  const listed = FileListReply.safeParse(listing);
  if (!listed.success)
    throw new StageError(
      "transport",
      `elegoo file list: unexpected reply: ${listed.error.message}`,
    );
  const files = listed.data.FileList.filter(({ type }) => type !== FOLDER).map(({ name }) => name);
  const doomed = filesToPrune(files, keep, printing);
  if (doomed.length === 0) return [];
  const deleted = await sendCommand(
    address,
    { mainboardId, cmd: SDCP_CMD.DELETE_FILES, data: { FileList: doomed, FolderList: [] } },
    true,
  );
  const reply = DeleteReply.safeParse(deleted);
  if (!reply.success)
    throw new StageError(
      "transport",
      `elegoo gave no usable reply to deleting ${doomed.join(", ")}, so it is unknown which went`,
    );
  const failed = new Set(reply.data.ErrData ?? []);
  if (failed.size === 0) return doomed;
  const removed = doomed.filter((name) => !failed.has(name));
  throw new StageError(
    "transport",
    `elegoo could not delete ${[...failed].join(", ")}; removed ${removed.join(", ") || "none"}`,
  );
}
