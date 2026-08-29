#!/usr/bin/env bash
#
# Install the pir-plan / pir-review-plan / pir-work / pir-implement / pir-review skills into
# a project, and append the shared working method to its CLAUDE.md.
#
#   ./install.sh /path/to/project          install into the project's .claude/skills/
#   ./install.sh --global                  install into ~/.claude/skills/ (skills only)
#
# Idempotent: re-running upgrades the skills in place and never appends CLAUDE.md twice.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="Appended by plan-implement-review"
SKILLS=(pir-plan pir-review-plan pir-work pir-implement pir-review)

if [[ "${1:-}" == "--global" ]]; then
    DEST="$HOME/.claude/skills"
    mkdir -p "$DEST"
    for s in "${SKILLS[@]}"; do
        rm -rf "${DEST:?}/$s"
        cp -R "$SRC/skills/$s" "$DEST/$s"
        echo "  installed $DEST/$s"
    done
    echo
    echo "Skills installed globally. CLAUDE.md is per-project — append it yourself:"
    echo "  cat $SRC/CLAUDE.md >> /path/to/project/CLAUDE.md"
    exit 0
fi

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    echo "usage: $0 /path/to/project   |   $0 --global" >&2
    exit 2
fi
if [[ ! -d "$TARGET" ]]; then
    echo "error: no such directory: $TARGET" >&2
    exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"

# 1. Skills
mkdir -p "$TARGET/.claude/skills"
for s in "${SKILLS[@]}"; do
    rm -rf "${TARGET:?}/.claude/skills/$s"
    cp -R "$SRC/skills/$s" "$TARGET/.claude/skills/$s"
    echo "  installed .claude/skills/$s"
done

# 2. CLAUDE.md — append once, never twice
CLAUDE="$TARGET/CLAUDE.md"
if [[ -f "$CLAUDE" ]] && grep -qF "$MARKER" "$CLAUDE"; then
    echo "  CLAUDE.md already carries the working method — left alone"
    echo "  (to refresh it, delete the appended block and re-run)"
else
    if [[ -f "$CLAUDE" ]]; then
        printf '\n\n---\n\n' >> "$CLAUDE"
        echo "  appended the working method to CLAUDE.md"
    else
        echo "  created CLAUDE.md"
    fi
    cat "$SRC/CLAUDE.md" >> "$CLAUDE"
fi

# 3. Where the plans will go
mkdir -p "$TARGET/plans"
[[ -e "$TARGET/plans/.gitkeep" ]] || touch "$TARGET/plans/.gitkeep"

cat <<MSG

Done. One thing left, by hand:

  Start Claude Code in $TARGET and run:

      /pir-plan

  then, in a NEW session, have the plan read back before any of it is built:

      /pir-review-plan {slug}

  then, one unit of work at a time:

      /pir-work {slug}
MSG
