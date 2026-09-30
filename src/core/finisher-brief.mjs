// Every message pir sends the finisher session (finisher DESIGN §2.2, §2.7, §2.8, §2.12). Pure: text in,
// text out, so the wording is reviewed in one place, as coordinator-brief.mjs does for the coordinator
// agent. The skill (skills/pir-finisher/SKILL.md) holds the procedure; these messages carry only the
// facts of this run and the one rule each moment needs restated.

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// Every message stays under 1500 characters (T02 done-when), so free text from outside (a typed answer,
// a stuck summary) is cut to a bound before it is quoted.
const clip = (s, max) => {
  const t = String(s).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// The fixed go question (DESIGN §2.7). pir opens the fence only on the person's answer `Go` to an
// AskUserQuestion whose header is exactly `Go` (isGoAnswer in finisher-policy.mjs), so every message
// that mentions the go names these exactly.
const GO_QUESTION = 'one AskUserQuestion, header `Go`, options `Go` and `Not yet`';

// chooseRules' source (finisher-policy.mjs) in words. `built-in` means none of the three rules files
// exists, which normally means install.sh never ran here (DESIGN §2.2); the finisher must say so in its
// ready summary.
const SOURCE_WORDS = {
  project: "the project's own rules, committed in the repo",
  yours: "the person's rules for this repo",
  default: 'the default rules',
  'built-in':
    "the engine's built-in default: no rules file exists (install.sh never ran, or the default was deleted); say so in your ready summary",
};

export function rulesSourceWords(source) {
  return SOURCE_WORDS[source] ?? `unknown source (${source ?? 'none'})`;
}

// finisherOpening(...) → the finisher's opening instruction (DESIGN §2.1, §2.2, §2.7). It names every
// path the session needs so it never has to guess one: the rules file and its source, the branch, the
// target branch, the person's main checkout (where the merge happens), the report and the status folder.
// `base` is the run's recorded base (`pirBase`): the target is a fact of the run, so it is stated here
// rather than left to the rules file, which may name another branch.
export function finisherOpening({ slug, branch, base, rulesPath, rulesSource, statusDir, reportPath, mainCheckout }) {
  return [
    `Invoke the pir-finisher skill and follow it. You are the finisher of the parallel build of plan \`${slug}\`: its branch is ready to merge into \`${base}\`.`,
    `Plan: ${slug}`,
    `Branch: ${branch}`,
    `Target branch: ${base}`,
    `Rules file: ${rulesPath}`,
    `Rules source: ${rulesSourceWords(rulesSource)}`,
    `Main checkout: ${mainCheckout}`,
    `Report: ${reportPath}`,
    `Status folder: ${statusDir}`,
    'You may only look until the person says go: pir refuses anything that changes a file, a branch or the world. ' +
      'Prepare the steps the rules ask for, write a `ready` status into the status folder, then ask the go question: ' +
      `${GO_QUESTION}. Only the person's \`Go\` answer to that question is the go; a chat message never is.`,
  ].join('\n');
}

// finisherResumed({ phase, stuckSummary, base }) → sent into a resumed session after it exited or pir
// restarted (DESIGN §2.12). A go question that was open is lost with the old process, so it is asked
// again; a restart mid-finish never carries the go over (afterRestart moved `finishing` to `stuck`, and
// `stuckSummary` is its text). The target is restated: the opening that named it may be far behind.
export function finisherResumed({ phase, stuckSummary = null, base = null } = {}) {
  const parts = ['pir restarted your session. You are still the finisher; follow the pir-finisher skill.'];
  if (nonEmpty(base)) parts[0] += ` The target branch is still \`${base}\`.`;
  if (phase === 'stuck' && nonEmpty(stuckSummary)) {
    parts.push(
      `Your phase is now stuck: ${clip(stuckSummary, 500)}`,
      'You may only look again. Check what is already done, write a `stuck` status with what is done, what is not and the steps ' +
        `left, then ask for a fresh go: ${GO_QUESTION}. The go you had before does not carry over.`,
    );
  } else if (phase === 'stuck' || phase === 'awaiting-go') {
    parts.push(
      `Your phase is ${phase}; you may only look. Any go question you had open was lost with the restart: ` +
        `ask it again, ${GO_QUESTION}, and wait for the person's answer.`,
    );
  } else if (phase === 'done') {
    parts.push('Your phase is done; there is nothing left for you to do.');
  } else if (phase === 'preparing' || phase == null) {
    parts.push(
      'Your phase is preparing; you may only look. Finish checking, write a `ready` status, then ask the go question: ' +
        `${GO_QUESTION}.`,
    );
  } else {
    // afterRestart never resumes into `finishing`, so any other phase here is a caller bug: name it as it
    // is rather than claim `preparing`, and send the finisher to the person.
    parts.push(`Your phase is ${clip(phase, 40)}. Tell the person what you were doing and ask what to do; take no step until they answer.`);
  }
  return parts.join('\n\n');
}

// finisherRefusal(why, file) → one of its status files was not applied (DESIGN §2.6): malformed, or
// the wrong kind for the phase. Nothing changed.
export function finisherRefusal(why, file = null) {
  const which = nonEmpty(file) ? `Your status file ${file}` : 'Your status file';
  // A reason that already ends in a full stop (checkStatus's own wording may) must not print `..`.
  const reason = clip(why, 500).replace(/[.\s]+$/, '');
  return `${which} was refused: ${reason}. Nothing changed. Write a new status file if you still mean it.`;
}

// finisherResynced({ base, baseSha }) → the target branch moved before any go and pir re-synced the branch
// (DESIGN §2.8). The phase is back to preparing, so the old plan of steps and any go given for it no longer count.
export function finisherResynced({ base, baseSha } = {}) {
  const sha = nonEmpty(baseSha) ? String(baseSha).slice(0, 12) : 'a new tip';
  const name = nonEmpty(base) ? base : 'The target branch';
  return (
    `${name} moved to ${sha} and pir merged it into the branch. Your phase is back to preparing: the steps you wrote ` +
    'no longer count, and neither would a go given for them. Re-check, write a fresh `ready` status, and ask the go ' +
    `question again: ${GO_QUESTION}.`
  );
}

const LOOK_ONLY_PHASES = new Set(['preparing', 'awaiting-go', 'stuck']);

// finisherGateRefusal(toolName, phase) → why the gate denied a tool call, and what the finisher may do
// in this phase (DESIGN §2.4). Only look-only phases and `done` deny by the gate; in `finishing` the only
// refusal is the person denying a parked reserved request, which the finisher turns into a `stuck`
// (DESIGN §2.12), so that phase says exactly that.
export function finisherGateRefusal(toolName, phase) {
  const tool = nonEmpty(toolName) ? toolName : 'that tool';
  if (phase === 'done') {
    return `${tool} was refused: your phase is done, and nothing more may run. Stop; pir is ending the run.`;
  }
  if (LOOK_ONLY_PHASES.has(phase)) {
    return (
      `${tool} was refused: your phase is ${phase}, so you may only look until the person says go. Allowed: Read, Glob and ` +
      'Grep; Bash commands made only of look-only parts (git status, log, diff, show, merge-tree and the like, ls, cat, ' +
      'grep, diff), with no redirection or command substitution; Write into the status folder only; the pir-finisher skill; ' +
      'and AskUserQuestion. If the steps need it, list it in your status and let the go approve it.'
    );
  }
  if (phase === 'finishing') {
    return (
      `${tool} was refused. Do not work around it. Stop, write a \`stuck\` status with what is done, what is not and the ` +
      `steps you would run next, then ask the go question again: ${GO_QUESTION}.`
    );
  }
  return `${tool} was refused by pir in phase ${phase ?? 'unknown'}. Say so to the person and ask what to do.`;
}

// finisherNotGo(answer) → the person answered the go question with something other than `Go` (DESIGN
// §2.7): the fence stays shut and the finisher waits, re-asking only when the person asks it to.
export function finisherNotGo(answer) {
  const said = nonEmpty(answer) ? `"${clip(answer, 300)}"` : 'something other than Go';
  return (
    `The person answered ${said}, not Go. Nothing is approved and you may still only look. Reply to what they said if it needs ` +
    `a reply, then wait. Ask the go question again only when they ask you to: ${GO_QUESTION}.`
  );
}

// finisherStaleGo(phase) → the person answered `Go`, but not to a go question pir can count (DESIGN §2.7):
// it was asked before a `ready`, or before the steps were re-prepared or the base moved, or the phase does not
// take a go. The finisher sees `Go` in the question's result, so it is told plainly the fence is still shut.
export function finisherStaleGo(phase) {
  return (
    `That Go does not count: the question was not asked after your latest \`ready\` or \`stuck\` status, or your phase ` +
    `(${phase ?? 'unknown'}) does not take a go. Nothing is approved and you may still only look. Write a \`ready\` status ` +
    `if you have not, then ask the go question again: ${GO_QUESTION}.`
  );
}
