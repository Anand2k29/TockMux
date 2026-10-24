import { parseArgs, formatFlagHelp, GLOBAL_FLAGS } from "./args.js";
import { createUI } from "./ui.js";
import { didYouMean } from "../tmx/parser.js";
import { TockError } from "../errors.js";
import { getVersion } from "../version.js";
import { findBrowser } from "../core/browser.js";
import { renderCommand, checkCommand, frameCommand, batchCommand, syncCommand, probeCommand } from "./commands/render.js";
import { watchCommand } from "./commands/watch.js";
import { runMenu } from "./commands/menu.js";
import { voiceCommand } from "./commands/voice.js";
import { presetsCommand, setupCommand, doctorCommand, initCommand, demoCommand, studioCommand, mcpCommand, aboutCommand } from "./commands/tools.js";

export const COMMANDS = [renderCommand, watchCommand, batchCommand, frameCommand, checkCommand, syncCommand, voiceCommand, studioCommand, mcpCommand, demoCommand, setupCommand, doctorCommand, initCommand, presetsCommand, probeCommand, aboutCommand];

const GROUPS = [
  ["Make a video", ["render", "watch", "batch", "frame", "check", "sync"]],
  ["Add a voice", ["voice"]],
  ["Use it your way", ["studio", "mcp"]],
  ["Get set up", ["demo", "setup", "doctor", "init", "presets", "probe", "about"]]
];

export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name || c.aliases.includes(name));
}

function printHelp(ui, cmd) {
  ui.banner({ compact: Boolean(cmd) });
  if (!cmd) {
    ui.write(`  ${ui.c.bold("Usage")}  tockmux <command> [options]\n`);
    for (const [title, names] of GROUPS) {
      ui.write(`  ${ui.c.violet(title)}`);
      for (const n of names) {
        const c = findCommand(n);
        ui.write(`    ${ui.c.bold(c.name.padEnd(9))} ${ui.c.gray(c.summary)}`);
      }
      ui.write();
    }
    ui.write(`  ${ui.c.gray("Details for any command:")} tockmux help <command>`);
    ui.write(`  ${ui.c.gray("New here? Run")} tockmux demo\n`);
    return;
  }
  ui.write(`  ${ui.c.bold(cmd.name)}  ${ui.c.gray(cmd.summary)}\n`);
  ui.write(`  ${ui.c.violet("Usage")}`);
  for (const u of cmd.usage) ui.write("    " + u);
  if (cmd.examples?.length) {
    ui.write(`\n  ${ui.c.violet("Examples")}`);
    for (const e of cmd.examples) ui.write("    " + e);
  }
  const flagLines = formatFlagHelp(cmd.flags || {});
  if (flagLines.length) {
    ui.write(`\n  ${ui.c.violet("Options")}`);
    flagLines.forEach((l) => ui.write(l));
  }
  ui.write(`\n  ${ui.c.violet("Everywhere")}`);
  formatFlagHelp({ json: GLOBAL_FLAGS.json, quiet: GLOBAL_FLAGS.quiet, "no-color": GLOBAL_FLAGS["no-color"] }).forEach((l) => ui.write(l));
  if (cmd.aliases?.length) ui.write(`\n  ${ui.c.gray("Also works as: " + cmd.aliases.join(", "))}`);
  ui.write();
}

async function printHome(ui) {
  ui.banner();
  ui.write(`  ${ui.c.violet("Get started")}`);
  ui.write(`    ${ui.c.bold("tockmux demo")}              ${ui.c.gray("render a sample video (checks your setup)")}`);
  ui.write(`    ${ui.c.bold("tockmux render my.html")}    ${ui.c.gray("turn your HTML animation into an MP4")}`);
  ui.write(`    ${ui.c.bold("tockmux studio")}            ${ui.c.gray("open the drag-and-drop app")}`);
  ui.write(`    ${ui.c.bold("tockmux help")}              ${ui.c.gray("see every command")}`);
  ui.write();
  const b = await findBrowser({}).catch(() => null);
  if (!b) ui.warn(`One-time step needed:  ${ui.c.bold("tockmux setup")}  ${ui.c.gray("(downloads the browser TockMux draws with)")}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const pre = { json: argv.includes("--json"), quiet: argv.includes("--quiet") || argv.includes("-q"), noColor: argv.includes("--no-color") };
  const ui = createUI(pre);
  let debug = argv.includes("--debug");
  try {
    if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
      process.stdout.write(getVersion() + "\n");
      return 0;
    }
    if (!argv.length) {
      if (process.stdin.isTTY && process.stdout.isTTY && !ui.json) {
        await runMenu({ ui, main });
        return 0;
      }
      await printHome(ui);
      return 0;
    }
    if (argv[0] === "menu") {
      await runMenu({ ui, main });
      return 0;
    }
    if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
      const target = argv[1] && findCommand(argv[1]);
      if (argv[1] && !target) ui.warn(`No command called "${argv[1]}".`);
      printHelp(ui, target);
      return 0;
    }
    const name = argv[0];
    const cmd = findCommand(name);
    if (!cmd) {
      // Convenience: `tockmux promo.html` behaves like `tockmux render promo.html`
      if (/\.(html?|tmx)$/i.test(name)) return await main(["render", ...argv]);
      const sug = didYouMean(name, COMMANDS.flatMap((c) => [c.name, ...c.aliases]));
      ui.error(`Unknown command "${name}".`, sug ? `Did you mean "tockmux ${sug}"?` : "See all commands with: tockmux help");
      return 2;
    }
    const { flags, positional, errors } = parseArgs(argv.slice(1), cmd.flags || {});
    debug = debug || flags.debug;
    if (flags.help) {
      printHelp(ui, cmd);
      return 0;
    }
    if (errors.length) {
      ui.error(errors[0], `${errors.slice(1).join("\n")}${errors.length > 1 ? "\n" : ""}See options with: tockmux help ${cmd.name}`);
      return 2;
    }
    const cmdUi = createUI({ json: flags.json, quiet: flags.quiet, noColor: flags.noColor });
    const out = (await cmd.run({ positional, flags, ui: cmdUi, invokedAs: name })) || {};
    if (out.json !== undefined) process.stdout.write(JSON.stringify(out.json, null, 2) + "\n");
    return out.exitCode ?? 0;
  } catch (e) {
    if (pre.json) {
      process.stdout.write(JSON.stringify({ error: { message: e.message, code: e.code || "ERROR", hint: e.hint || "" } }, null, 2) + "\n");
      return e.exitCode || 1;
    }
    if (e instanceof TockError) {
      ui.error(e.message, e.hint);
      if (debug) console.error(e.stack);
      return e.exitCode || 1;
    }
    ui.error("Something unexpected went wrong.", `${e.message}\nRe-run with --debug for details, or ask on Discord: Spidey_Moon`);
    if (debug) console.error(e.stack);
    return 1;
  }
}
