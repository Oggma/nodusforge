#!/usr/bin/env node
/**
 * NodusForge example app.
 *
 * Dependency-free Node script that prints colored log lines every second and
 * shuts down cleanly on SIGINT/SIGTERM. Use it to try Start/Stop and the log
 * viewer without setting up a real project.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timestamp = () => new Date().toISOString().slice(11, 19);
const write = (color, message) =>
  console.log(`\x1b[${color}m[${timestamp()}] ${message}\x1b[0m`);

let running = true;

const stop = (signal) => {
  if (!running) return;
  running = false;
  write(36, `received ${signal} — stopping gracefully`);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

write(36, "NodusForge example logger started");
write(90, `pid ${process.pid}; press Stop in the UI or send SIGINT/SIGTERM`);

let tick = 0;

while (running) {
  if (tick > 0 && tick % 9 === 0) {
    write(33, `warning: example warning at tick ${tick}`);
  } else if (tick > 0 && tick % 13 === 0) {
    console.error(
      `\x1b[31m[${timestamp()}] error: example non-fatal error at tick ${tick}\x1b[0m`,
    );
  } else {
    write(32, `tick ${String(tick).padStart(3, "0")} — logs are streaming`);
  }

  tick += 1;
  await sleep(1000);
}

write(36, "example logger stopped");
