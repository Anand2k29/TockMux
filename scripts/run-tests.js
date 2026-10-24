#!/usr/bin/env node
// Portable test runner: Node 18/20/22 disagree about directories and globs, but all accept explicit file paths.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "test");
const args = process.argv.slice(2);
const fast = args.includes("--fast");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join("test", f));
const nodeArgs = ["--test", "--test-concurrency=1"];
// --fast: tests that need a real browser skip themselves (they check TOCKMUX_NO_RENDER).
const env = fast ? { ...process.env, TOCKMUX_NO_RENDER: "1" } : process.env;
const child = spawn(process.execPath, [...nodeArgs, ...files], { cwd: root, stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 1));
