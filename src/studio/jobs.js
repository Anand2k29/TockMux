import crypto from "node:crypto";
import fs from "node:fs";

/**
 * A small in-memory job queue. Renders are CPU heavy, so only `maxJobs` run at once and the
 * rest wait their turn. Finished jobs (and their files) are removed after `ttlMs`.
 */
export class JobQueue {
  constructor({ maxJobs = 1, ttlMs = 30 * 60 * 1000 } = {}) {
    this.maxJobs = maxJobs;
    this.ttlMs = ttlMs;
    this.jobs = new Map();
    this.running = 0;
    this.seq = 0;
    this.sweeper = setInterval(() => this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  create({ dir, run }) {
    const id = crypto.randomBytes(8).toString("hex");
    const job = { id, seq: ++this.seq, dir, status: "queued", progress: null, result: null, error: null, createdAt: Date.now(), listeners: new Set(), controller: new AbortController(), run };
    this.jobs.set(id, job);
    this.pump();
    return job;
  }

  get(id) {
    return this.jobs.get(id);
  }

  emit(job, type, data) {
    for (const fn of job.listeners) fn({ type, data });
  }

  subscribe(job, fn) {
    job.listeners.add(fn);
    return () => job.listeners.delete(fn);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "queued") {
      job.status = "cancelled";
      this.emit(job, "error", { message: "Cancelled" });
    } else if (job.status === "running") job.controller.abort();
    return true;
  }

  /** How many jobs must finish (or are running) before this one starts. */
  ahead(job) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j === job) continue;
      if (j.status === "running" || (j.status === "queued" && j.seq < job.seq)) n++;
    }
    return n;
  }

  pump() {
    for (const job of this.jobs.values()) {
      if (this.running >= this.maxJobs) return;
      if (job.status !== "queued") continue;
      this.running++;
      job.status = "running";
      this.emit(job, "status", { status: "running" });
      Promise.resolve()
        .then(() =>
          job.run({
            signal: job.controller.signal,
            onProgress: (p) => {
              job.progress = p;
              this.emit(job, "progress", p);
            },
            onLog: (m) => this.emit(job, "log", { message: m })
          })
        )
        .then((result) => {
          job.status = "done";
          job.result = result;
          job.finishedAt = Date.now();
          this.emit(job, "done", result);
        })
        .catch((e) => {
          job.status = job.controller.signal.aborted ? "cancelled" : "error";
          job.error = { message: e.message, hint: e.hint || "" };
          job.finishedAt = Date.now();
          this.emit(job, "error", job.error);
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  remove(job) {
    this.jobs.delete(job.id);
    fs.rmSync(job.dir, { recursive: true, force: true });
  }

  sweep() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.finishedAt && now - job.finishedAt > this.ttlMs) this.remove(job);
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const job of this.jobs.values()) {
      job.controller.abort();
      this.remove(job);
    }
  }
}
