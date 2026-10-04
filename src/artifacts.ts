// SPDX-License-Identifier: Apache-2.0
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

export interface Artifact {
  path: string;
  /** Output root; descendants must stay within its real path. */
  root?: string;
  content: string | Uint8Array;
  isOwned(saved: Uint8Array): boolean;
}

// Resolve existing ancestors without writes. The selected root may be an alias
// (including macOS /tmp); its descendants must stay within its real path.
async function canonicalDirectory(path: string): Promise<string> {
  const missing: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    let exists = true;
    try {
      await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) {
      const canonical = await realpath(current);
      if (!(await stat(canonical)).isDirectory())
        throw new Error(`Output requires a directory: ${current}`);
      return resolve(canonical, ...missing.reverse());
    }
    if (dirname(current) === current)
      throw new Error(`Output has no existing parent directory: ${path}`);
    missing.push(basename(current));
  }
}

function contained(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return (
    suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  );
}

async function destination(artifact: Artifact): Promise<string> {
  const path = resolve(artifact.path);
  if (!artifact.root) return path;
  const root = resolve(artifact.root);
  if (path === root || !contained(root, path))
    throw new Error(`Path is outside the output directory: ${path}`);
  const canonicalRoot = await canonicalDirectory(root);
  const canonicalParent = await canonicalDirectory(dirname(path));
  if (!contained(canonicalRoot, canonicalParent))
    throw new Error(
      `Output symlink points outside the selected directory: ${path}`,
    );
  return resolve(canonicalParent, basename(path));
}

export function generatedJSON(saved: Uint8Array): boolean {
  try {
    return (
      JSON.parse(Buffer.from(saved).toString("utf8")).generator === "astro-fyne"
    );
  } catch {
    return false;
  }
}

export function generatedText(header: string): (saved: Uint8Array) => boolean {
  const marker = Buffer.from(header);
  return (saved) =>
    Buffer.from(saved).subarray(0, marker.length).equals(marker);
}

/** Validate destinations and stage files before replacing generated outputs. */
export async function applyArtifacts(
  artifacts: Artifact[],
  options: { check: boolean },
): Promise<void> {
  const paths = new Set<string>();
  const pending: { path: string; content: Buffer; temporary?: string }[] = [];
  for (const artifact of artifacts) {
    const path = await destination(artifact);
    if (paths.has(path)) throw new Error(`Duplicate output: ${path}`);
    paths.add(path);
    let saved: Buffer | undefined;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(
          `Preserving destination not owned by the generator: ${path}`,
        );
      saved = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const content = Buffer.from(artifact.content);
    if (options.check) {
      if (!saved?.equals(content))
        throw new Error(`Generated artifact is out of date: ${path}`);
    } else {
      if (saved && !artifact.isOwned(saved))
        throw new Error(`Preserving file not owned by the generator: ${path}`);
      if (!saved?.equals(content)) pending.push({ path, content });
    }
  }
  if (options.check) return;
  try {
    for (const artifact of pending) {
      await mkdir(dirname(artifact.path), { recursive: true });
      artifact.temporary = `${artifact.path}.${randomUUID()}.tmp`;
      await writeFile(artifact.temporary, artifact.content, { flag: "wx" });
    }
    for (const artifact of pending)
      await rename(artifact.temporary!, artifact.path);
  } finally {
    await Promise.all(
      pending.map(({ temporary }) =>
        temporary ? unlink(temporary).catch(() => undefined) : undefined,
      ),
    );
  }
}
