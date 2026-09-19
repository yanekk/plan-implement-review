#!/usr/bin/env bash
#
# Install the plan-implement-review skills for your account and, optionally, append the
# shared working method to a project's CLAUDE.md.
#
# The skills are ALWAYS installed user-scoped, under ~/.claude/skills/, so every project
# sees one copy and none can drift onto a stale one. A per-project copy was how they went
# out of date; there is no per-project skill install any more.
#
# The parallel coordinator ENGINE (src/, driven by /pir-coordinate) is installed the same way,
# under ~/.claude/pir-engine/, so parallel mode can run against ANY repo — the engine reads its
# target from the coordinator session's working directory, so it operates on whatever project it
# is launched in. Before this it was a source file living only in this repo, which is why parallel
# mode was trapped here while a plan in a real product repo had nowhere to run.
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
SKILLS=(pir-plan pir-review-plan pir-parallelize-plan pir-work pir-implement pir-review pir-install pir-coordinate pir-verify pir-worker)

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
    install_engine
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
MSG
