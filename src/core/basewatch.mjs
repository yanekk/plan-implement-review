// The base watch: one look at the base while a run waits for the person's merge, reduced to a verdict
// (single-finisher DESIGN §2.9). Builds and single runs share it, so a fix to "merged or moved" lands in
// both programs. The shell does every read — the remote's refresh, the containment check, the tip — and
// passes the results in; this module only decides.

// 'merged' | 'moved' | null.
// containsTip: whether any watched ref (local base, remote-tracking base) holds the branch tip.
// localTip:    the local base's commit now; localSeen: the local tip recorded at the last sync.
// watched:     prepareBase's result if the remote was refreshed this pass, else null.
// baseSha:     the commit the last sync merged.
export function baseWatchVerdict({ containsTip, localTip, localSeen, watched, baseSha }) {
  // Merged wins over moved: once the base holds the tip the run is over, whatever else changed.
  if (containsTip) return 'merged';
  // The local tip is compared with the one seen at the sync, not with baseSha, since the sync may have
  // merged the remote's copy while the local branch stays behind it (a checked-out base with changes,
  // base-branch DESIGN §2.3). A failed refresh says nothing about the remote, so only an ok one counts.
  const localMoved = localTip !== localSeen;
  const remoteMoved = !!watched?.ok && watched.sha !== baseSha;
  return localMoved || remoteMoved ? 'moved' : null;
}

// Whether the remote is due a refresh this pass. watchFrom null means never refreshed: the clock starts
// now and the first refresh comes watchMs later, so a run's first pass costs no network.
export function watchDue({ now, watchFrom, watchMs }) {
  if (watchFrom == null) return { due: false, watchFrom: now };
  if (now - watchFrom >= watchMs) return { due: true, watchFrom: now };
  return { due: false, watchFrom };
}
