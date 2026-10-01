# api-service — delivery report

## What was delivered

All 11 tasks are built and reviewed, and the tests are green on the feature branch after the latest main was merged in.

**What pir can do now**

- **A small local service that reports Claude subscription usage.** It answers on this Mac only, at `http://127.0.0.1:47717`, with how much of the 5-hour and weekly limit is used and when that reading was heard. A second address, `/health`, says whether the service is up.
- **Every pir run feeds it.** Each session pir holds (build workers, planning sessions, the coordinator agent) saves the usage numbers it hears to one file, and the service answers from that file. A run never waits on the service, and the last reading survives a restart or a reboot.
- **It starts at login and comes back if killed.** `./install.sh` registers it with macOS and restarts it on every later install.
- **`pir service`, `pir service on`, `pir service off`.** The first says whether it is running and shows the last reading. Off stays off across installs until you turn it on again.
- **Documentation.** A new page in `/docs` describes the service, and the README has a section on it.

**What workers saw working for real during the build**

- macOS starting the real service code, restarting it after a kill (0.1 s when it had been up over 10 s, 10 s otherwise) and stopping it cleanly. This ran under a temporary test name that removed itself.
- Real Claude sessions producing usage readings and the service serving them: 8 readings in 90 seconds, and the final answer equal to the newest reading.

These were driven by workers, not checked by you.

**What is not delivered yet**

- **The service is not running on your Mac.** The real install could not happen while this build was live. It is the first step after the merge.
- **Nothing has been seen after a log-out and log-in.** Only you can do that.
- **The cockpit's side is not part of this plan.** The agentic-ide plan still needs to be told what was settled here: port 47717, the health address, no check of the `Host` header, and the error answers.
- **macOS only.** On anything else `pir service` says it needs macOS.
- **Only runs started through `pir` on a Claude subscription report usage.** A run started before the install reports nothing until it is stopped and started again.

## Decisions made for you

- **T03: When macOS refuses to register the service, its error comes as two lines, the second being "Try re-running the command as root for richer errors." What should `pir service on` show after "pir service: macOS would not register it:"?**
  Answer: When macOS refuses to register the service, its error comes as two lines, the second being "Try re-running the command as root for richer errors." What should `pir service on` show after "pir service: macOS would not register it:"? → First line only (Recommended)
  Why: DESIGN §2.7 writes this text as two lines, like every other status text: one line carrying launchctl's message, then pir's own advice. It does not say what to do with a multi-line message. The first line keeps that two-line shape and drops macOS's 'run as root' advice, which contradicts pir's own 'try: pir service off, then pir service on'. A rule tied to one macOS sentence would break on a rewording.

## What to check by hand

Do these in order, after you have merged. Each answer should be written into the plan's findings log with the date.

1. **Install it.** With no pir run live:

   ```
   ./install.sh
   pir service
   ```

   Expect: `pir service: running at http://127.0.0.1:47717 (pid …)`, then either a reading line or `no usage reading yet`. macOS may show a notice about a new background item the first time. Way back: `pir service off`.

   Worth noting: whether macOS showed that notice, and what System Settings → General → Login Items shows for it. Neither was seen during the build.

2. **Check the numbers during a real run.** Start any pir run, then:

   ```
   curl -s "$(jq -r .url ~/.pir/api.json)/v1/usage"
   ```

   Expect: percentages that match what Claude shows for your 5-hour and weekly limits, and an `observed_at` value that changes when you repeat the command a few minutes later.

3. **Kill it and see it come back.**

   ```
   kill -9 "$(jq -r .pid ~/.pir/api.json)"
   sleep 12
   pir service
   ```

   Expect: running again, with a different pid. It undoes itself; nothing is lost because the reading is a file.

4. **Log out and log in**, then run `pir service` without starting anything. Expect: running.

5. **Tell the agentic-ide plan** what was settled: port 47717, the `/health` address, no `Host` check, and the error answers. Then check that the cockpit's footer stays current during a pir run. That is the reason this was built.

## Risks and follow-ups

**Worth a look before or soon after merging**

- **The merge with main had conflicts in six files, resolved by a worker.** They include the list of commands workers may run without asking (both sides' entries were combined, at your say-so) and the file every worker session starts through. The tests are green afterwards, but nobody other than that worker has read the result.
- **A run on the old engine reports nothing.** After installing, stop and restart any run that was already going, or the footer stays stale for it.
- **A real port clash has not been seen.** If another program holds 47717, `pir service` should say so and the service should retry every 10 seconds. That wording is tested, but it has not been seen with a real clash.

**Known gaps, left as they are**

- **If `~/.claude` is a link to another folder**, `pir service on` and the install step refuse with `run the installed pir`. Not the case on this Mac today.
- **The guard that keeps tests away from your real usage file compares folder names as text.** Your home folder spelled another way (different capitals, a trailing `/.`, through a link) would slip past it. A test file run directly with `node`, outside the test command, is also not caught.
- **A worker inside a live run can write a fake reading to your real usage file** if it runs a test script by hand, outside the test command. The cockpit would show fake numbers until the next real reading.
- **On a scratch home, plain `pir service` says `registered but not answering`** and suggests off-then-on, though nothing is registered there. The docs say so; the wording was left.
- **If the usage file is ever replaced by a folder**, each reading leaves a small leftover file behind, silently.
- **The design said the service uses only Node itself and pir's pure rules.** It also uses two of pir's own file helpers. It still needs no installed package, which is what the rule was for, and the docs describe it that way.
- **Any web page open on this Mac is not specially blocked** from trying the service's address. You dropped that check knowingly at plan review. It is listed so it is not forgotten.

**Follow-ups**

- **The detached-runs page in `/docs` lists neither `pir service` nor `pir notify`**, and says any other word is an unknown command. Outside this plan's files.
- **The test suite fails at random when several workers run it at once** (the terminal-driving tests time out under heavy load, a different one each time). It is green when the machine is quiet. Not investigated. Rerun before suspecting the code.
- **Two live checks used to leave things running when interrupted** (a temporary login item, and a set of sessions). Both were reproduced, fixed and locked with tests during review.

## Branch

Synced with `main` at `33d589ac4ea6` on 2026-09-30T11:04:04Z.
Tests: green.
