# Prototype — a worker's conversation in `pir`

Throwaway mock, approved by the user 2026-09-24 (DESIGN §7). Open `index.html` in a browser.
Published copy: https://claude.ai/artifact/GxFrWoUsxFVzuRzRbYzrWA

It is a reference for the feel of the conversation view (T13), not a spec: fake data, canned replies,
and a browser imitating a terminal. DESIGN §2.11 is the spec where the two differ. Decided against it:
one line per step is the default, Tab for full detail. Since the mock, the key map changed: Esc
interrupts the worker and ← with an empty box goes back; the permission prompt gains `a` (do not ask
this worker again).
