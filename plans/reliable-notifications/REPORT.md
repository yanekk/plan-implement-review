# reliable-notifications — delivery report

## What was delivered

All nine tasks are done and reviewed, and the tests pass.

- **pir now alerts your phone itself**, through the free ntfy app, instead of relying on the Claude app's own notifications, which came late or not at all.
- **You're alerted only when a question is actually yours**: the coordinator agent passed it on, took longer than 5 minutes to answer, the action needs your yes (like a push to GitHub or anything destructive), or the agent is down or switched off. Questions the agent answers itself never buzz the phone.
- **Each alert says** which plan and task it's from, why it came to you, and the start of the question. Tapping it opens that worker's chat in the Claude app.
- **One reminder** 15 minutes later if the question is still open, never more. The alert disappears from the phone once the question is answered.
- **One alert when the build is ready to merge**, or when it's stuck (tests failing, or the merge with main unresolved). Tapping it opens the coordinator agent's chat.
- **`pir notify`** sets up a phone in one command: it makes a private topic, prints it with a QR code and the steps, and sends a test alert. `pir notify test` sends another test; `pir notify off` stops all alerts, including in a run already going.
- **The Claude app stays quiet** for build workers once alerts are set up, so you don't get two buzzes for one question.
- **An icon** for the alerts. As you chose, it shows on Android only; the iPhone app always shows ntfy's own logo.
- The README and the docs describe all of this. Planning sessions still never alert, as planned.

Not delivered: nothing from the plan was dropped.

## Decisions made for you

None.

## What to check by hand

Everything this plan needed a person for was already checked with you on your iPhone on 28 September: the question alert, the reminder, the tap into the worker's chat, the alert clearing after you answered, the Claude app staying silent, and the tap on the ready-to-merge alert into the agent's chat.

One thing worth doing after you merge: **reinstall pir** (run `./install.sh` in the project) so the `pir notify` command reaches your everyday `pir`. Until then, your installed copy doesn't have it. Then run `pir notify` once. It keeps the topic you already set up and just prints it again. Check that it shows your existing topic rather than a new one.

## Risks and follow-ups

- **Keep the feature branch on GitHub after merging.** The alert icon is served from that branch's copy. Deleting the branch takes the icon offline. Alerts still arrive, and it only matters on Android anyway. Where the icon lives for good is still open; moving it later is a one-line change.
- **Practice runs can reach your real phone.** Now that your phone is set up, a practice run of pir's test harness, if started without its separate scratch settings, would send real alerts to it. Worth a small follow-up so practice runs never use your real alert settings unless asked.
- **The install script and one test still say pir has two outside packages**; it now has three (the QR code one was added). That doesn't break anything, but it's worth correcting in a small follow-up.
- **The QR code only scans the right way round on a dark terminal**; on a light background it comes out inverted. It doesn't matter much: the iPhone ntfy app can't scan codes anyway, so the printed steps lead with typing the topic.
- **Keep your topic name private.** Anyone who knows it can read your alerts. `pir notify off` followed by `pir notify` gives you a fresh one; you'd then subscribe again on the phone.

## Branch

Synced with `main` at `1dbac86185e2` on 2026-09-29T04:29:05Z.
The tests were red at the end; a worker fixed them.
Tests: green.
