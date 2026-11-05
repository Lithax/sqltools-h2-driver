import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';

const DEFAULT_BASE = 'https://repo1.maven.org/maven2/com/h2database/h2';

/** Where downloaded jars live. Shared by the extension host and the SQLTools language server process. */
export const managedDir = () => path.join(os.homedir(), '.sqltools-h2');

export interface DownloadResult {
  path: string;
  version: string;
  downloaded: boolean;
}

export const expandHome = (p: string) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p);

const cmpVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
};

/** Highest-versioned h2-X.Y.Z.jar in the managed folder, if any. */
export function findManagedJar(dir = managedDir()): string | undefined {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch (_) {
    return undefined;
  }
  const jars = files
    .map((f) => ({ f, m: /^h2-(\d+(?:\.\d+)*)\.jar$/.exec(f) }))
    .filter((x) => x.m && fs.statSync(path.join(dir, x.f)).size > 0)
    .sort((a, b) => cmpVersion(b.m![1], a.m![1]));
  return jars.length ? path.join(dir, jars[0].f) : undefined;
}

class HttpError extends Error {
  constructor(public statusCode: number, url: string) {
    super(`HTTP ${statusCode} for ${url}`);
  }
}

function get(url: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, { headers: { 'User-Agent': 'sqltools-h2-driver' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        return resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new HttpError(code, url));
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
    req.on('error', reject);
  });
}

export function parseLatestVersion(xml: string): string {
  const numeric = (v: string) => /^\d+(\.\d+)*$/.test(v);
  const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(xml) || /<latest>\s*([^<\s]+)\s*<\/latest>/.exec(xml);
  if (release && numeric(release[1])) return release[1];

  const versions: string[] = [];
  const re = /<version>\s*([^<\s]+)\s*<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) if (numeric(m[1])) versions.push(m[1]);
  if (!versions.length) throw new Error('no versions found in maven-metadata.xml');
  return versions.sort(cmpVersion).pop()!;
}

let inflight: Promise<DownloadResult> | null = null;

/**
 * Downloads the newest H2 jar from Maven Central into ~/.sqltools-h2 (verifies the published SHA-1).
 * Set SQLTOOLS_H2_MAVEN_URL to use a mirror (URL of the .../com/h2database/h2 folder).
 */
export function downloadLatest(opts: { baseUrl?: string; dir?: string } = {}): Promise<DownloadResult> {
  if (!inflight) inflight = doDownload(opts).finally(() => (inflight = null));
  return inflight;
}

async function doDownload(opts: { baseUrl?: string; dir?: string }): Promise<DownloadResult> {
  const base = (opts.baseUrl || process.env.SQLTOOLS_H2_MAVEN_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const dir = opts.dir || managedDir();
  const hint = ' (You can download h2.jar manually and choose "Use my own h2.jar" in the connection settings.)';

  let version: string;
  try {
    version = parseLatestVersion((await get(`${base}/maven-metadata.xml`)).toString('utf8'));
  } catch (e) {
    throw new Error(`Could not look up the latest H2 version: ${(e as Error).message}.${hint}`);
  }

  const target = path.join(dir, `h2-${version}.jar`);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return { path: target, version, downloaded: false };

  const jarUrl = `${base}/${version}/h2-${version}.jar`;
  let jar: Buffer;
  try {
    jar = await get(jarUrl);
  } catch (e) {
    throw new Error(`Could not download ${jarUrl}: ${(e as Error).message}.${hint}`);
  }
  if (jar.length < 1024 || jar[0] !== 0x50 || jar[1] !== 0x4b) throw new Error(`Downloaded file is not a valid jar (${jarUrl})`);

  try {
    const expected = (await get(`${jarUrl}.sha1`)).toString('utf8').trim().split(/\s+/)[0].toLowerCase();
    if (/^[0-9a-f]{40}$/.test(expected) && expected !== crypto.createHash('sha1').update(jar).digest('hex')) {
      throw new Error(`Checksum mismatch for ${jarUrl}`);
    }
  } catch (e) {
    if (!(e instanceof HttpError && e.statusCode === 404)) throw e; // no .sha1 published: skip verification
  }

  fs.mkdirSync(dir, { recursive: true });
  const part = `${target}.${process.pid}.${Date.now()}.part`;
  fs.writeFileSync(part, jar);
  fs.renameSync(part, target);

  // tidy up older managed versions (ignore failures, e.g. jar still in use on Windows)
  for (const f of fs.readdirSync(dir)) {
    if (/^h2-\d+(\.\d+)*\.jar$/.test(f) && path.join(dir, f) !== target) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (_) {
        /* ignore */
      }
    }
  }
  return { path: target, version, downloaded: true };
}

/** Jar to use: the configured one, else the managed one (downloading it on first use). */
export async function resolveJar(configured?: string): Promise<string> {
  if (configured && configured.trim()) {
    const p = expandHome(configured.trim());
    if (!fs.existsSync(p)) throw new Error(`h2.jar not found at ${p}`);
    return p;
  }
  return findManagedJar() || (await downloadLatest()).path;
}
