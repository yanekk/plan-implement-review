#!/usr/bin/env node
// T16 by-eye check: judge the live-display colours on YOUR real terminal.
// Drives the real renderer (src/shell/render.mjs) with representative display states — no paid
// workers, nothing touched outside this process. Colour is exactly what a real run paints.
//
//   node run-t16-colour-check.mjs
//
// Each state is held ~4s in the alternate screen; its name is in the header line. Ctrl-C any time.
//
// What is LIVE-visible in a real run: the RUNNING state — the per-status row tints (active cyan,
// merged green, idle dim) and the amber-bold "asking you" parked pointer, redrawn every pass.
// The FINISHED / RED / INTERRUPTED end-states are shown here so you can judge those colours too,
// BUT in a real run the coordinator wipes that final frame on teardown and prints a plain hand-off
// line instead (post-T15 alt-screen; FINDINGS 2026-09-20). So focus your verdict on RUNNING.

import { createRenderer } from './src/shell/render.mjs';
import { buildDisplay } from './src/core/display.mjs';

const NOW = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each entry: a header caption (carried in `branch` so it shows in the painted header) and a runState.
const states = [
  {
    caption: 'RUNNING (this is what you see live)',
    run: {
      ceiling: 4,
      tasks: [
        { id: 'T01', slug: 'stop-promoting', deps: [], done: true, phase: null, since: null, doneMs: 6400, question: null },
        { id: 'T02', slug: 'live-display', deps: [], done: false, phase: 'building', since: NOW - 42000, doneMs: null, question: null },
        { id: 'T03', slug: 'harness-and-restart', deps: [], done: false, phase: 'reviewing', since: NOW - 12000, doneMs: null, question: null },
        { id: 'T04', slug: 'worker-permissions', deps: [], done: false, phase: 'asking', since: NOW - 90000, doneMs: null, question: 'long question the person answers in claude agents' },
        { id: 'T05', slug: 'docs', deps: ['T04'], done: false, phase: null, since: null, doneMs: null, question: null },
        { id: 'T06', slug: 'skills', deps: [], done: false, phase: null, since: null, doneMs: null, question: null },
      ],
    },
  },
  {
    caption: 'FINISHED (end-frame — wiped in a real run)',
    run: { complete: true, readyToMerge: true, ceiling: 4, tasks: [
      { id: 'T01', slug: 'stop-promoting', deps: [], done: true, phase: null, since: null, doneMs: 6400, question: null },
      { id: 'T02', slug: 'live-display', deps: [], done: true, phase: null, since: null, doneMs: 30100, question: null },
    ] },
  },
  {
    caption: 'RED / failed (end-frame — wiped in a real run)',
    run: { complete: true, readyToMerge: false, ceiling: 4, tasks: [
      { id: 'T01', slug: 'stop-promoting', deps: [], done: true, phase: null, since: null, doneMs: 6400, question: null },
      { id: 'T02', slug: 'live-display', deps: [], done: true, phase: null, since: null, doneMs: 30100, question: null },
    ] },
  },
  {
    caption: 'INTERRUPTED (Ctrl-C — NOT painted in a real run)',
    run: { interrupted: true, ceiling: 4, tasks: [
      { id: 'T01', slug: 'stop-promoting', deps: [], done: false, phase: 'building', since: NOW - 8000, doneMs: null, question: null },
    ] },
  },
];

const renderer = createRenderer({ stream: process.stdout, colour: true });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { renderer.close(); process.exit(0); });

for (const { caption, run } of states) {
  const display = buildDisplay({ branch: caption, ...run }, { now: NOW });
  renderer.paint(display);
  await sleep(4000);
}
renderer.close();
console.log('\nDone. Tell me: do the RUNNING colours read well, and does the amber-bold "asking you" row jump out?');
