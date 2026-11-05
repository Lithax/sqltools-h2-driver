import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

export interface BridgeOptions {
  javaPath?: string;
  h2Jar: string;
  url: string;
  user?: string;
  password?: string;
}

export interface BridgeResult {
  ok: boolean;
  error?: string;
  cols?: string[];
  rows?: any[][];
  updated?: number;
}

const expandHome = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/** Talks to bridge/H2Bridge.java (run with the Java source launcher) over stdin/stdout. */
export default class H2Bridge {
  private proc: ChildProcessWithoutNullStreams;
  private waiters: Array<{ resolve: (r: BridgeResult) => void; reject: (e: Error) => void }> = [];
  private stderr = '';
  private dead: Error | null = null;

  static async start(opts: BridgeOptions): Promise<H2Bridge> {
    const bridge = new H2Bridge(opts);
    const hello = await new Promise<BridgeResult>((resolve, reject) => bridge.waiters.push({ resolve, reject }));
    if (!hello.ok) {
      bridge.close();
      throw new Error(hello.error || 'Could not connect to H2');
    }
    return bridge;
  }

  private constructor(opts: BridgeOptions) {
    // out/ls/plugin.js -> <extension root>/bridge/H2Bridge.java
    const source = path.resolve(__dirname, '..', '..', 'bridge', 'H2Bridge.java');
    this.proc = spawn(opts.javaPath || 'java', ['-cp', expandHome(opts.h2Jar), source], {
      env: {
        ...process.env,
        H2_URL: opts.url,
        H2_USER: opts.user || '',
        H2_PASSWORD: opts.password || '',
      },
    });

    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.proc.on('error', (e) => this.fail(new Error(`Could not start Java (${opts.javaPath || 'java'}): ${e.message}`)));
    this.proc.on('exit', (code) =>
      this.fail(new Error(`H2 bridge exited (code ${code}). ${this.stderr}`.trim()))
    );

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const w = this.waiters.shift();
      if (!w) return;
      try {
        w.resolve(JSON.parse(line));
      } catch (e) {
        w.reject(new Error(`Bad bridge output: ${line.slice(0, 200)}`));
      }
    });
  }

  private fail(err: Error) {
    if (this.dead) return;
    this.dead = err;
    this.waiters.splice(0).forEach((w) => w.reject(err));
  }

  request(sql: string): Promise<BridgeResult> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.proc.stdin.write(Buffer.from(sql, 'utf8').toString('base64') + '\n');
    });
  }

  close() {
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch (_) {
      /* ignore */
    }
  }
}
