import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { UserConfig } from 'tsdown';

const adapter = fileURLToPath(new URL('./tools/client-build.js', import.meta.url));
if (!existsSync(adapter)) throw new Error('externalClientBundle adapter is missing.');
const { externalClientBundle } = await import(pathToFileURL(adapter).href);

export default externalClientBundle('dsh-writeon', ['src/dsh-writeon.ts'], {
  clientEntry: 'src/client/index.tsx',
}) as UserConfig[];
