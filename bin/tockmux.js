#!/usr/bin/env node
import { main } from "../src/cli/main.js";

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error("TockMux needs Node.js 18 or newer. You have " + process.versions.node + ". Get the latest from https://nodejs.org");
  process.exit(1);
}

main().then((code) => {
  process.exitCode = code;
});
