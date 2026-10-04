// SPDX-License-Identifier: Apache-2.0
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface Artifact {
  path: string;
  content: string | Uint8Array;
  isOwned(saved: Uint8Array): boolean;
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

/** Validate all destinations, then stage complete files before replacing generated outputs. */
export async function applyArtifacts(
  artifacts: Artifact[],
  options: { check: boolean },
): Promise<void> {
  const paths = new Set<string>();
  const pending: { path: string; content: Buffer; temporary?: string }[] = [];
  for (const artifact of artifacts) {
    const path = resolve(artifact.path);
    if (paths.has(path)) throw new Error(`Salida duplicada: ${path}`);
    paths.add(path);
    let saved: Buffer | undefined;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Se conserva el destino ajeno al generador: ${path}`);
      saved = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const content = Buffer.from(artifact.content);
    if (options.check) {
      if (!saved?.equals(content))
        throw new Error(`Generado desactualizado: ${path}`);
    } else {
      if (saved && !artifact.isOwned(saved))
        throw new Error(`Se conserva el archivo ajeno al generador: ${path}`);
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
