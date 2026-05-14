import { spawn as nodeSpawn } from "node:child_process";

type Platform = NodeJS.Platform;

interface ChildLike {
  once(
    event: "error" | "close",
    handler: (value: Error | number | null) => void
  ): ChildLike;
  unref(): ChildLike;
}

type SpawnLike = (
  cmd: string,
  args: string[],
  options: { shell: false; stdio: "ignore"; detached: true }
) => ChildLike;

export interface OpenExternalUrlOptions {
  platform?: Platform;
  spawn?: SpawnLike;
}

export interface OpenExternalUrlResult {
  cmd: string;
  args: string[];
}

function openerForPlatform(platform: Platform): {
  cmd: string;
  args: (url: string) => string[];
} {
  switch (platform) {
    case "darwin":
      return { cmd: "open", args: (url) => [url] };
    case "win32":
      return { cmd: "cmd", args: (url) => ["/c", "start", "", url] };
    default:
      return { cmd: "xdg-open", args: (url) => [url] };
  }
}

/**
 * Open a URL with the platform default browser and resolve only after the
 * opener process reports success. The URL is always passed as argv with
 * shell:false; callers must validate protocol before calling this helper.
 */
export async function openExternalUrl(
  url: string,
  opts: OpenExternalUrlOptions = {}
): Promise<OpenExternalUrlResult> {
  const opener = openerForPlatform(opts.platform ?? process.platform);
  const args = opener.args(url);
  const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnLike);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(opener.cmd, args, {
      shell: false,
      stdio: "ignore",
      detached: true,
    });

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.once("error", (err) => settle(() => reject(err)));
    child.once("close", (code) =>
      settle(() => {
        if (code === 0) resolve();
        else reject(new Error(`${opener.cmd} exited with code ${code}`));
      })
    );
    child.unref();
  });

  return { cmd: opener.cmd, args };
}
