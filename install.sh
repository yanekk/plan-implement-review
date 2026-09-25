#!/usr/bin/env bash
#
# Install the plan-implement-review skills for your account and, optionally, append the
# shared working method to a project's CLAUDE.md.
#
# The skills are ALWAYS installed user-scoped, under ~/.claude/skills/, so every project
# sees one copy and none can drift onto a stale one. A per-project copy was how they went
# out of date; there is no per-project skill install any more.
#
# The parallel coordinator ENGINE (src/) is installed the same way, under ~/.claude/pir-engine/,
# so parallel mode can run against ANY repo — the engine reads its target from the coordinator's
# working directory, so it operates on whatever project it is launched in. Before this it was a
# source file living only in this repo, which is why parallel mode was trapped here while a plan
# in a real product repo had nowhere to run.
#
#   ./install.sh                     refresh the skills for your account (skills only)
#   ./install.sh --global            the same, named explicitly
#   ./install.sh /path/to/project    refresh the skills AND append the method to that
#                                    project's CLAUDE.md, and make its plans/ directory
#
# Idempotent: re-running refreshes the skills in place and never appends CLAUDE.md twice.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="Appended by plan-implement-review"
DEST="$HOME/.claude/skills"
ENGINE_DEST="$HOME/.claude/pir-engine"
SKILLS=(pir-plan pir-review-plan pir-work pir-implement pir-review pir-install pir-worker)
# The user-facing launchers, both installed onto the PATH the same way (install_launcher): pir-coordinate
# drives a foreground run, pir (T13) starts one detached and opens the cross-repo dashboard.
LAUNCHERS=(pir-coordinate pir)

# Skills deleted from the repo when parallel mode stopped being agentic (T07): the coordinator is
# now a plain command, not a skill, and the verify/parallelize helpers went with the you/auto split.
# install.sh only refreshes the SKILLS array, so it never removed these; they linger in accounts that
# installed an earlier version, advertising the old agentic coordinator. Removed idempotently (T18).
ORPHAN_SKILLS=(pir-coordinate pir-verify pir-parallelize-plan)

install_skills() {
    mkdir -p "$DEST"
    for s in "${SKILLS[@]}"; do
        rm -rf "${DEST:?}/$s"
        cp -R "$SRC/skills/$s" "$DEST/$s"
        echo "  refreshed $DEST/$s"
    done
    # pir-install amends any project's CLAUDE.md, so it needs the routine text on hand even
    # when run from a repo that is not this one. Drop a fresh copy beside it.
    cp "$SRC/CLAUDE.md" "$DEST/pir-install/PIR-CLAUDE.md"
    echo "  refreshed $DEST/pir-install/PIR-CLAUDE.md"
    remove_orphan_skills
    install_engine
    install_launcher
}

# True when $1 is a directory on the current PATH.
on_path() {
    case ":$PATH:" in
        *":$1:"*) return 0 ;;
        *) return 1 ;;
    esac
}

# Delete the orphan skills (see ORPHAN_SKILLS) idempotently. rm -rf is a no-op if already gone.
remove_orphan_skills() {
    for s in "${ORPHAN_SKILLS[@]}"; do
        if [[ -e "$DEST/$s" ]]; then
            rm -rf "${DEST:?}/$s"
            echo "  removed the stale orphan skill $DEST/$s"
        fi
    done
}

# Install the launchers onto a PATH directory (pir-coordinate T18, pir T13). Both are logic-free
# wrappers (DESIGN §2.1, §2.9) that exec the engine; the installed engine path is baked in HERE, at
# install time — sed substitutes the same __PIR_ENGINE__ placeholder in each with ENGINE_DEST — so a
# command runs from any repo, not just this one. Prefer ~/.local/bin (already on this user's PATH;
# `claude` lives there); if it is absent or off PATH, fall back to ~/.claude/bin and print the exact
# export PATH step once, never silently installing commands the user cannot invoke (the
# apply_automode_rule pattern).
install_launcher() {
    local bindir name
    if [[ -d "$HOME/.local/bin" ]] && on_path "$HOME/.local/bin"; then
        bindir="$HOME/.local/bin"
    else
        bindir="$HOME/.claude/bin"
    fi
    mkdir -p "$bindir"
    # '@' delimiter so the '/'-heavy engine path needs no escaping. Same substitution for both
    # launchers: each carries the __PIR_ENGINE__ placeholder and its own engine entrypoint.
    for name in "${LAUNCHERS[@]}"; do
        sed "s@__PIR_ENGINE__@$ENGINE_DEST@" "$SRC/bin/$name" > "$bindir/$name"
        chmod +x "$bindir/$name"
        echo "  installed the launcher $bindir/$name"
    done
    if ! on_path "$bindir"; then
        cat <<STEP
  $bindir is not on your PATH — add it so \`pir\` and \`pir-coordinate\` resolve:

      export PATH="$bindir:\$PATH"

  (put that line in your shell profile to make it stick.)
STEP
    fi
}

install_engine() {
    # The whole src/ tree is copied (core/ + shell/ and nothing else), preserving the sibling
    # layout the engine's relative imports need. Copying the tree wholesale — rather than a
    # curated file list — means a future dependency added to the engine cannot silently break the
    # installed copy, a failure that would only surface in a live parallel run. The engine reads
    # nothing relative to its own path, so it runs correctly from ~/.claude/pir-engine/.
    rm -rf "${ENGINE_DEST:?}"
    mkdir -p "$ENGINE_DEST"
    cp -R "$SRC/src" "$ENGINE_DEST/src"
    echo "  refreshed $ENGINE_DEST/src (parallel coordinator engine)"
    install_engine_deps
}

# The engine's two runtime packages (pi-tui, the Agent SDK; live-workers DESIGN §5) go in a
# node_modules beside the engine's src/, where its bare imports resolve. The rm -rf above wipes
# them, so every install re-fetches the lockfile's exact versions and needs the network. The omit
# flags repeat .npmrc on purpose: a CLI --omit REPLACES the .npmrc list rather than adding to it,
# so `--omit=dev` alone would pull in the SDK's ~95 peer packages and its 222 MB bundled claude.
ENGINE_DEPS_FAILED=0
install_engine_deps() {
    cp "$SRC/package.json" "$SRC/package-lock.json" "$SRC/.npmrc" "$ENGINE_DEST/"
    if (cd "$ENGINE_DEST" && npm ci --omit=dev --omit=peer --omit=optional --no-audit --no-fund --no-update-notifier >/dev/null); then
        echo "  installed $ENGINE_DEST/node_modules (engine runtime packages)"
    else
        ENGINE_DEPS_FAILED=1
        echo "  could not install the engine's packages in $ENGINE_DEST (npm ci failed)" >&2
    fi
}

# Printed last, so a failed package install is not scrolled away: without node_modules the
# installed pir cannot start. Exit non-zero so a script driving install.sh sees it too.
report_engine_deps() {
    [[ "$ENGINE_DEPS_FAILED" == 0 ]] && return 0
    cat >&2 <<STEP

  The engine's packages did NOT install, so the installed pir will not start.
  npm ci needs the network (every install re-fetches them). Once online, re-run:

      ./install.sh

STEP
    exit 1
}

MERGE="$SRC/src/shell/settings-merge.mjs"

# Carry the framework's narrow worker permissions.allow into a target project's
# .claude/settings.json, merging rather than clobbering an existing list. So a worker's own
# bare git/npm commands resolve before the auto-mode classifier runs (T06, DESIGN §7). The
# ship list is read from THIS repo's own .claude/settings.json, so there is one source of truth.
merge_project_permissions() {
    local target="$1"
    if node "$MERGE" project "$target/.claude/settings.json" "$SRC/.claude/settings.json"; then
        echo "  merged the worker permissions into $target/.claude/settings.json"
    else
        echo "  could not write $target/.claude/settings.json — add its permissions.allow by hand" >&2
    fi
}

# Merge pir's auto-mode exception into the USER-global ~/.claude/settings.json (the classifier
# ignores autoMode in a project file, by design). This is the one-time per-user setup parallel
# mode needs; a person running install.sh in their own terminal clears it here. A Claude session
# running the installer may be blocked from writing auto-mode config (self-modification), so on
# any failure we print the exact manual step and never silently skip it (T06, DESIGN §7).
apply_automode_rule() {
    local user_settings="$HOME/.claude/settings.json"
    if node "$MERGE" automode "$user_settings"; then
        echo "  applied pir's auto-mode exception to $user_settings"
        echo "  confirm it took with:  claude auto-mode config"
        return 0
    fi
    print_automode_manual_step
    return 0
}

# The fallback the installer prints when it cannot write the auto-mode rule itself. It quotes
# the exact rule text from the merge tool, so there is no second copy to drift.
print_automode_manual_step() {
    local rule
    rule="$(node "$MERGE" automode-rule 2>/dev/null || echo '<the pir worker git rule>')"
    cat >&2 <<STEP

  Parallel mode needs one per-user setting the installer could not write:
  add pir's auto-mode exception to ~/.claude/settings.json under "autoMode.allow".
  Do it by hand, either way:

    * In Claude Code:  /permissions  ->  Auto mode tab, add the rule
    * Or edit ~/.claude/settings.json and append to autoMode.allow (keep "\$defaults"):

        $rule

  Then confirm:  claude auto-mode config
STEP
}

append_claude_md() {
    local target="$1" claude="$1/CLAUDE.md"
    if [[ -f "$claude" ]] && grep -qF "$MARKER" "$claude"; then
        echo "  CLAUDE.md already carries the working method — left alone"
        echo "  (to refresh it, delete the appended block and re-run)"
    elif [[ -f "$claude" ]]; then
        printf '\n\n---\n\n' >> "$claude"
        cat "$SRC/CLAUDE.md" >> "$claude"
        echo "  appended the working method to CLAUDE.md"
    else
        cat "$SRC/CLAUDE.md" > "$claude"
        echo "  created CLAUDE.md"
    fi
    mkdir -p "$target/plans"
    [[ -e "$target/plans/.gitkeep" ]] || touch "$target/plans/.gitkeep"
}

TARGET="${1:-}"

if [[ -z "$TARGET" || "$TARGET" == "--global" ]]; then
    install_skills
    apply_automode_rule
    echo
    echo "Skills installed for your account. To set up a project, run from inside it:"
    echo "    /pir-install"
    echo "or append the method by hand:"
    echo "    ./install.sh /path/to/project"
    echo
    echo "To run a reviewed plan in parallel, from inside a set-up repo:"
    echo "    pir {slug}      # start detached, drop into its live view"
    echo "    pir             # the cross-repo dashboard"
    echo "The foreground launcher pir-coordinate {slug} is deprecated; prefer pir {slug}, which"
    echo "runs live and detached. (pir-coordinate still runs, and is the only dry-by-default rehearsal.)"
    report_engine_deps
    exit 0
fi

if [[ ! -d "$TARGET" ]]; then
    echo "error: no such directory: $TARGET" >&2
    exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"

install_skills
merge_project_permissions "$TARGET"
apply_automode_rule
append_claude_md "$TARGET"

cat <<MSG

Done. One thing left, by hand:

  Start Claude Code in $TARGET and run:

      /pir-plan

  then, in a NEW session, have the plan read back before any of it is built:

      /pir-review-plan {slug}

  then, one unit of work at a time:

      /pir-work {slug}

  or, to run a reviewed plan in parallel instead (from inside the repo):

      pir {slug}      # start detached, drop into its live view
      pir             # the cross-repo dashboard

  (the foreground launcher pir-coordinate {slug} is deprecated; prefer pir {slug}.)
MSG
report_engine_deps
