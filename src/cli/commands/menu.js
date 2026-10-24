import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const PKG_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The sample films that ship with the package, in the order the menu shows them. */
export const SAMPLES = [
  { file: "examples/demo.tmx", label: "Title film: a short demo (6 seconds)" },
  { file: "examples/story.tmx", label: "Title film: a story in scenes" },
  { file: "examples/promo.html", label: "HTML page: an animated promo (asks for seconds)" }
];

/**
 * One line reader for the whole menu session. One reader means piped or pasted input is never lost between prompts.
 * Lines that arrive before someone asks for them are queued. When input ends, answers are null.
 */
function createReader() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const queue = [];
  const waiting = [];
  let ended = false;
  rl.on("line", (line) => {
    if (waiting.length) waiting.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    ended = true;
    while (waiting.length) waiting.shift()(null);
  });
  const nextLine = () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  };
  return {
    async ask(question) {
      process.stdout.write(question);
      const line = await nextLine();
      return line === null ? null : line.trim();
    },
    /** All lines up to one that is exactly END. */
    async untilEnd() {
      const lines = [];
      for (;;) {
        const line = await nextLine();
        if (line === null || line.trim() === "END") break;
        lines.push(line);
      }
      return lines.join("\n");
    },
    close() {
      rl.close();
    }
  };
}

let reader = null;

/** A typed answer, or "0" (quit) when input has ended. */
async function ask(question) {
  const answer = await reader.ask(question);
  return answer === null ? "0" : answer;
}

/** Drag-and-drop on Windows pastes paths wrapped in quotes. Remove them. */
function cleanPath(p) {
  return p.replace(/^["']|["']$/g, "").trim();
}

/** Ask how long the video should be. Empty means "use the length in the file". */
async function askSeconds(ui) {
  const answer = await ask(ui.c.bold("How many seconds? ") + ui.c.gray("(press Enter to use the length in the file, or 10) "));
  if (!answer) return [];
  const n = Number(answer);
  if (!Number.isFinite(n) || n <= 0) {
    ui.warn(`"${answer}" is not a number of seconds. Using the length in the file.`);
    return [];
  }
  return ["--duration", String(n)];
}

/** Ask for a file, check that it exists, and return its full path. */
async function askFile(ui, question) {
  const p = cleanPath(await ask(ui.c.bold(question) + " "));
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    ui.error(`No file at ${p}`, "Check the spelling, or drag the file into this window and press Enter.");
    return null;
  }
  return abs;
}

/** Save pasted HTML into a folder the user can find. */
function savePasted(html) {
  const dir = path.resolve("tockmux-pasted");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `page-${stamp}.html`);
  fs.writeFileSync(file, html, "utf8");
  return file;
}

/** The output file for a sample, next to where the user runs the command. */
function sampleOutput(file) {
  return path.resolve(path.basename(file, path.extname(file)) + ".mp4");
}

const MENU = [
  ["1", "Make a video from an HTML file I already have"],
  ["2", "Paste HTML here, then make a video from it"],
  ["3", "Make a video from a sample (choose 1, 2 or 3)"],
  ["4", "Surprise me: make a video from a random sample"],
  ["5", "Watch a file and re-render every time I save it"],
  ["6", "Check a file first (will it convert well?)"],
  ["7", "Open the drag-and-drop app in my browser"],
  ["8", "Check my setup and tell me what to fix"],
  ["9", "Show me how this works (short guide)"],
  ["0", "Quit"]
];

function printMenu(ui) {
  ui.write(ui.c.bold("  What do you want to do? ") + ui.c.gray("Type a number and press Enter."));
  ui.write();
  for (const [n, text] of MENU) ui.write(`   ${ui.c.violet(n)}  ${text}`);
  ui.write();
}

function printGuide(ui) {
  ui.write(ui.c.bold("  How TockMux works, in four lines"));
  ui.write("  1. Your page is an HTML file that moves by itself (CSS or JavaScript animation).");
  ui.write("  2. TockMux opens it in a browser and controls the clock, one frame at a time.");
  ui.write("  3. Each frame is saved and joined into an MP4, GIF or WebM file.");
  ui.write("  4. The same page gives the same video every time.");
  ui.write();
  ui.write("  Full guide: the README in the package, or run " + ui.c.bold("tockmux help") + ".");
  ui.write();
}

/** Run another TockMux command in this same window. */
async function run(main, args) {
  await main(args);
}

async function menuLoop(ui, main) {
  for (;;) {
    printMenu(ui);
    const choice = await ask(ui.c.bold("Your choice: "));
    ui.write();

    if (choice === "0" || choice === "") return;

    if (choice === "1") {
      const file = await askFile(ui, "Path to your .html or .tmx file (drag it into the window):");
      if (!file) continue;
      const extra = file.toLowerCase().endsWith(".html") ? await askSeconds(ui) : [];
      await run(main, ["render", file, ...extra]);
    } else if (choice === "2") {
      ui.write(ui.c.bold("Paste your HTML below."));
      ui.dim("When you have pasted everything, type END on a line by itself and press Enter.\n");
      const html = await reader.untilEnd();
      if (!html.trim()) {
        ui.warn("Nothing was pasted, so there is nothing to render.");
        continue;
      }
      const file = savePasted(html);
      ui.success(`Saved your page to ${ui.rel(file)}`);
      const extra = await askSeconds(ui);
      await run(main, ["render", file, ...extra]);
    } else if (choice === "3") {
      ui.write(ui.c.bold("Samples"));
      SAMPLES.forEach((s, i) => ui.write(`   ${ui.c.violet(String(i + 1))}  ${s.label}`));
      ui.write();
      const pick = Number(await ask(ui.c.bold("Which sample? ")));
      const sample = SAMPLES[pick - 1];
      if (!sample) {
        ui.warn("Type 1, 2 or 3.");
        continue;
      }
      const file = path.join(PKG_ROOT, sample.file);
      const extra = file.endsWith(".html") ? await askSeconds(ui) : [];
      await run(main, ["render", file, "--output", sampleOutput(file), ...extra]);
    } else if (choice === "4") {
      const sample = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
      ui.write(`${ui.c.violet("Random pick:")} ${sample.label}`);
      ui.write();
      const file = path.join(PKG_ROOT, sample.file);
      const extra = file.endsWith(".html") ? await askSeconds(ui) : [];
      await run(main, ["render", file, "--output", sampleOutput(file), ...extra]);
    } else if (choice === "5") {
      const file = await askFile(ui, "Path to the file to watch:");
      if (!file) continue;
      await run(main, ["watch", file]);
      return;
    } else if (choice === "6") {
      const file = await askFile(ui, "Path to the file to check:");
      if (!file) continue;
      await run(main, ["check", file]);
    } else if (choice === "7") {
      await run(main, ["studio"]);
      return;
    } else if (choice === "8") {
      await run(main, ["doctor"]);
    } else if (choice === "9") {
      printGuide(ui);
    } else {
      ui.warn(`"${choice}" is not on the list. Type a number from 0 to 9.`);
    }

    ui.write();
    await ask(ui.c.gray("Press Enter to go back to the menu... "));
    ui.write();
  }
}

/**
 * The numbered menu. Shown by `tockmux` with no arguments in a terminal, or by `tockmux menu`.
 * Every choice calls an ordinary command, so the menu adds no behaviour of its own.
 */
export async function runMenu({ ui, main }) {
  ui.banner({ compact: true });
  reader = createReader();
  try {
    await menuLoop(ui, main);
  } finally {
    reader.close();
  }
}
