import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Writes files into a new temp folder and returns its path. */
export function tempDir(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillflow-test-'));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (name.endsWith('.sh')) fs.chmodSync(file, 0o755);
  }
  return dir;
}
