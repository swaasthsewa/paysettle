/**
 * F3.04 evidence object store. Files are content-addressed by SHA-256 and written once (WORM-style: an existing object is
 * never overwritten). Default backend: local disk under ./uploads/<sha256> (gitignored; EVIDENCE_DIR overrides the folder).
 * An S3 bucket with Object Lock (compliance mode) can replace LocalDiskStore by implementing the same two methods.
 * P11: stored bytes are untrusted; this layer never interprets them.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ObjectStore {
  /** Store bytes under their sha256. Idempotent; never replaces an existing object. */
  putObject(sha256: string, bytes: Buffer): Promise<void>;
  /** Read an object, or null when it does not exist. */
  getObject(sha256: string): Promise<Buffer | null>;
}

const SHA_RE = /^[a-f0-9]{64}$/;
export const isSha = (s: string) => SHA_RE.test(s);

export class LocalDiskStore implements ObjectStore {
  constructor(readonly dir: string = process.env.EVIDENCE_DIR ?? path.join(process.cwd(), "uploads")) {}
  private file(sha: string) {
    if (!isSha(sha)) throw new Error("invalid object key");
    return path.join(this.dir, sha);
  }
  async putObject(sha: string, bytes: Buffer): Promise<void> {
    const f = this.file(sha);
    await mkdir(this.dir, { recursive: true });
    try { await stat(f); return; } catch { /* not there yet */ }
    try { await writeFile(f, bytes, { flag: "wx", mode: 0o440 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  async getObject(sha: string): Promise<Buffer | null> {
    try { return await readFile(this.file(sha)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
}

let current: ObjectStore | null = null;
export const objectStore = (): ObjectStore => (current ??= new LocalDiskStore());
/** Tests and alternative deployments swap the backend here. */
export const setObjectStore = (s: ObjectStore | null) => { current = s; };
