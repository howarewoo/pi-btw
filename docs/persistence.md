# Persistence and recovery

This page covers where side threads are saved, what is restored after a reload or restart, and
what happens to requests that were still running.

## Where threads are saved

Thread snapshots and SDK transcripts are stored in versioned, hidden custom entries
(`howarewoo.btw.v1`) in the **parent session file**. These entries do not enter the parent's
model context and do not create visible save notes. They can contain the same sensitive
conversation/project information as the parent; protect the session file accordingly.

## Checkpoints and interrupted turns

Creation and meaningful message/turn checkpoints are saved. Restoration reads only the
current session branch. Unfinished restored turns become **interrupted**, and no paid
request is automatically replayed. An abrupt crash can lose an unfinished streaming tail
since the last checkpoint. Resume manually with a follow-up if you want another call.

## Reloads, branches and ephemeral sessions

Clean reload, shutdown, session replacement, and tree navigation stop/dispose the affected
children. Late async completions cannot append into a replacement branch/session. Returning
to an older branch restores its last saved state rather than importing another branch's threads.
Drafts and viewport positions are runtime-only and are not restored after restart/reload.
`--no-session` parent sessions are ephemeral, including their BTW checkpoints.

## Long threads

No automatic compaction or retry is enabled in child sessions. Very long side threads may
hit provider context limits and fail visibly; start a fresh `/btw <prompt>` when needed.
