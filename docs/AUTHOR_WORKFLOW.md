# Author workflow change scope

The author requested readable Chinese forms, AI character proposals, pausable
chapter/beat/book generation, and conservative paragraph polishing/rewriting.

The existing chapter pipeline remains in its original phase order. The new
writing-run coordinator calls that pipeline one chapter or beat at a time.
Its opt-in `writing_run` payload lets the writer use a selected beat, the
author's instructions, an explicit token limit, and append subsequent beats
without replacing earlier prose. Existing `/jobs/write` calls keep their
previous replacement behavior. Storage paths and append-only logs are unchanged.

Acceptance criteria:

- Card forms and everyday model settings use Chinese labels; internal IDs and
  raw configuration stay out of the default author flow.
- AI proposals use the configured task profile; failures are visible and never
  masquerade as generated content. Proposals require author acceptance.
- Runs persist their unit list, next unit, and current child job under project
  `meta/writing_runs/`. Pause takes effect after the active unit. Resume does not
  regenerate completed units. After a server restart an interrupted unit can be
  retried explicitly; the prior chapter draft is snapshotted by the pipeline.
- Book scope means the chapters already created or listed in the story plan.
- Polish corrects grammar, subjects, references, collocations, and punctuation
  while preserving meaning and voice. Rewrite uses the author's requested style.
  Both return only the revised text, leave other paragraphs unchanged, detect
  stale edits, and record accepted changes as patch operations plus unified diff.
- New service tests, existing backend tests, frontend build and typecheck pass.

## Latest saved material and relationship retrieval

The author additionally requested AI assistance on individual card fields while
keeping separate character, world, and style cards. Generated fields are editable
proposals; an explicit save makes them the current author material. Reads must
use the latest saved version. Startup demo seeding and older indexes must not
overwrite it. Existing snapshots and append-only history remain for traceability;
they do not authorize an automatic rollback of author edits.

The Obsidian-inspired direction adds explicit relationships, reverse links and
source-aware retrieval over the current files. It preserves citations and fact
verification, distinguishes inference from confirmed facts, and respects the
current/past chapter boundary. Relationship indexing must not create a second
authoritative storage layout or silently introduce future character knowledge.

Field generation, saved-edit visibility, interrupted runs and retrieval need
tests. Token reductions and real-provider output quality require measured
requests; the relationship graph alone is not evidence for either. Live Obsidian
sync remains a separately scoped optional integration.
