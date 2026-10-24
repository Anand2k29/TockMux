import fs from "node:fs";
import path from "node:path";
import { convert } from "../../core/pipeline.js";
import { RENDER_FLAGS, ensureBrowser } from "./render.js";
import { TockError } from "../../errors.js";

const DEBOUNCE_MS = 300;

/** Re-render whenever the file is saved. Editors often write twice, so changes are debounced. */
export const watchCommand = {
  name: "watch",
  aliases: ["dev"],
  summary: "Re-render the video every time you save the file",
  usage: ["tockmux watch <file.html|file.tmx> [render options]"],
  examples: ["tockmux watch promo.html", "tockmux watch story.tmx --format gif"],
  flags: Object.fromEntries(Object.entries(RENDER_FLAGS).filter(([k]) => !["voice", "tts", "music"].includes(k))),
  async run({ positional, flags, ui }) {
    const input = positional[0];
    if (!input) throw new TockError("Tell me which file to watch.", { hint: "Example: tockmux watch promo.html", code: "NO_INPUT" });
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) throw new TockError(`No such file: ${input}`, { code: "FILE_NOT_FOUND" });

    ui.banner({ compact: true });
    await ensureBrowser(ui, flags);
    ui.step(`Watching ${ui.c.bold(path.basename(abs))}  ${ui.c.gray("save the file to render, Ctrl+C to stop")}`);
    ui.write();

    let busy = false;
    let queued = false;
    let timer = null;
    let renders = 0;

    const build = async () => {
      if (busy) {
        queued = true;
        return;
      }
      busy = true;
      renders += 1;
      const started = Date.now();
      ui.dim(`[${new Date().toLocaleTimeString()}] render #${renders} started`);
      try {
        const r = await convert({ input: abs, flags: { ...flags, output: flags.output ? path.resolve(flags.output) : undefined } });
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        ui.success(`${ui.rel(r.output)} ${ui.c.gray(`${ui.sym.dot} ${r.durationSec}s video ${ui.sym.dot} rendered in ${secs}s`)}`);
        r.warnings.forEach((w) => ui.warn(w));
      } catch (e) {
        ui.error(e.message, e.hint || "Fix the file and save again. Still watching.");
      } finally {
        busy = false;
        if (queued) {
          queued = false;
          build();
        }
      }
    };

    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(build, DEBOUNCE_MS);
    };

    const watcher = fs.watch(abs, onChange);
    await build();

    await new Promise((resolve) => {
      const stop = () => {
        watcher.close();
        clearTimeout(timer);
        ui.write();
        ui.dim("Stopped watching.");
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return { json: { watched: abs, renders } };
  }
};
