/**
 * Evaluate a top-level declaration from `server.js` in isolation.
 *
 * `server.js` exports nothing and calls `listen()` at module load, so there is
 * no import seam. Lifting the declaration out of the source text keeps a guard
 * honest — it reads whatever is actually in the file today, with no duplicated
 * copy that can quietly fall out of date.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SERVER_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');

/**
 * @param {RegExp} pattern matches the whole declaration, including `const ... ;`
 * @param {string} name the identifier to return
 * @param {string} testFile where to go if the pattern stops matching
 */
export const liftFromServer = (pattern, name, testFile) => {
  const match = SERVER_SOURCE.match(pattern);
  if (!match) {
    throw new Error(
      `Could not find ${name} in server.js. If it was renamed or reformatted, ` +
        `update the pattern in ${testFile} — do not delete this test.`
    );
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}\nreturn ${name};`)();
};
