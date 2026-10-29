import { isSafeRepositoryPath } from "@/server/analysis/validators";

/**
 * Tiny ZIP (store/no-compression) writer for the review export.
 *
 * We deliberately avoid a general archive dependency and only accept file paths
 * that pass RepoRescue's repository-path policy. The generated archive has no
 * symlinks, no executable metadata and no filesystem access.
 */

export type ArchiveFile = { path: string; content: string };

const text = new TextEncoder();
const MAX_ARCHIVE_FILES = 64;
const MAX_ARCHIVE_BYTES = 900_000;

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value & 0xffff, true);
  return result;
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value >>> 0, true);
  return result;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function dosTime(now: Date): { time: number; date: number } {
  const year = Math.max(1980, now.getUTCFullYear());
  return {
    time: (now.getUTCSeconds() >> 1) | (now.getUTCMinutes() << 5) | (now.getUTCHours() << 11),
    date: now.getUTCDate() | ((now.getUTCMonth() + 1) << 5) | ((year - 1980) << 9),
  };
}

function safeArchivePath(path: string): boolean {
  // Metadata files are constrained to a single known folder. Proposed source
  // files additionally reuse the strict repository-path validator.
  if (path.startsWith("files/")) return isSafeRepositoryPath(path.slice("files/".length));
  return /^(manifest\.json|proposed\.patch|REVIEW\.md)$/.test(path);
}

export function createZip(files: ArchiveFile[], now = new Date()): Uint8Array {
  if (files.length === 0) throw new Error("An export must include at least one file.");
  if (files.length > MAX_ARCHIVE_FILES) throw new Error(`An export may include at most ${MAX_ARCHIVE_FILES} files.`);

  const unique = new Set<string>();
  const prepared = files.map((file) => {
    if (!safeArchivePath(file.path) || unique.has(file.path)) {
      throw new Error("Export contained an unsafe or duplicate archive path.");
    }
    unique.add(file.path);
    const name = text.encode(file.path);
    const body = text.encode(file.content);
    return { path: file.path, name, body, crc: crc32(body) };
  });

  const totalContent = prepared.reduce((total, file) => total + file.body.byteLength, 0);
  if (totalContent > MAX_ARCHIVE_BYTES) {
    throw new Error(`Export content exceeds the ${MAX_ARCHIVE_BYTES} byte safety limit.`);
  }

  const stamp = dosTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of prepared) {
    const localHeader = concatenate([
      u32(0x04034b50), // local file header signature
      u16(20), // version needed
      u16(0), // flags
      u16(0), // store (no compression)
      u16(stamp.time),
      u16(stamp.date),
      u32(file.crc),
      u32(file.body.byteLength),
      u32(file.body.byteLength),
      u16(file.name.byteLength),
      u16(0),
      file.name,
      file.body,
    ]);
    locals.push(localHeader);

    centrals.push(
      concatenate([
        u32(0x02014b50), // central directory signature
        u16(20), // made by
        u16(20), // version needed
        u16(0),
        u16(0),
        u16(stamp.time),
        u16(stamp.date),
        u32(file.crc),
        u32(file.body.byteLength),
        u32(file.body.byteLength),
        u16(file.name.byteLength),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk start
        u16(0), // internal attributes
        u32(0), // external attributes
        u32(offset),
        file.name,
      ]),
    );
    offset += localHeader.byteLength;
  }

  const central = concatenate(centrals);
  const ending = concatenate([
    u32(0x06054b50), // end of central directory
    u16(0),
    u16(0),
    u16(prepared.length),
    u16(prepared.length),
    u32(central.byteLength),
    u32(offset),
    u16(0), // archive comment
  ]);
  return concatenate([...locals, central, ending]);
}
