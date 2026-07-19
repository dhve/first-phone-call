# AgentFacts card — decisions and known gotchas

This repo publishes an AgentFacts / Agent Card at [`agentfacts.json`](./agentfacts.json)
(NANDA ecosystem format) describing `react-native-device-agent`'s example demo app:
Gemma 3 270M Instruct (Q8_0 GGUF) running fully offline via llama.rn, with all 7
built-in tool groups enabled plus one custom tool (`get_current_time`).

Background and the decision process behind this file live in `.vscode/`:
- `nanda-index-agent-facts-report.md` — what AgentFacts/NANDA is
- `agentfacts-approaches-survey.md` — survey of real-world card formats
- `host39_plan.txt` — the aspirational phone-agent product this harness is a building block for

The card's shape was decided by a 4-package review (honest-minimal / Host39-aspirational /
pragmatic-today / rigorous-formal), judged by independent reviewers. The winning shape is a
**hybrid**: the lean, A2A-compatible `agentfacts.org/schema/v1` core, plus exactly one custom
extension block (`x_device_agent`) for the things that don't fit that schema.

## Deliberate choices, and what they cost

Read `agentfacts.json`'s own `x_device_agent.known_limitations` array before relying on this
card for anything — it's the machine-readable version of this list. In prose:

- **No invocation endpoint.** `endpoints.static` is intentionally empty. This card is
  discovery/documentation metadata only — **nothing can actually call this agent through it**.
  There's no server, no relay, no A2A runtime URL.
- **Not registered with the live NANDA index.** It's a reference file in this repo, resolvable
  only via `facts_url` if someone already has it — not discoverable through NANDA's
  `AgentName → Index → FactsURL` resolution pipeline.
- **Unsigned.** No keypair, no signature, no verification section. Authenticity/integrity of
  this document cannot be cryptographically checked — treat it as self-published metadata.
- **No DID/URN identity.** `id` is a plain string (`react-native-device-agent`, the actual npm
  package name), not a resolvable decentralized identifier. Deliberately **not** using Host39's
  planned email-based URN scheme (`urn:ai:email:<account-email>:agent:<slug>`) — that would bake
  a real personal email into this public repo's permanent git history for a resolver that
  doesn't exist yet.
- **`capabilities.authentication` is omitted** even though the base schema technically requires
  it (see `schema_deviations` in the JSON). OS-level runtime permissions (contacts, calendar,
  location, notifications) don't fit an OAuth/API-key-shaped auth model — they're declared
  instead in the custom `device_permissions` block, which generic A2A/OASF tooling won't
  recognize natively.
- **No performance, reputation, or certification data.** Zero real telemetry exists for this
  project — no latency numbers, no `maxTokens`, no SLA, no audit. Nothing here is fabricated to
  fill those sections; they're absent instead.
- **Model licensing is summarized, not exhaustive.** Gemma 3 is under Google's Gemma Terms of
  Use — restrictive, not OSI-approved — noted with a link, but redistribution/use-case clauses
  aren't broken out in detail. No GGUF checksum is declared either.
- **Small-model risk isn't formally benchmarked.** Gemma 3 270M is tiny; tool-call reliability
  is expected to be weaker than with larger instruction-tuned models, but this hasn't been
  measured.
- **This describes the demo app's configuration, not the package's full range.** All 7 tool
  groups happen to be enabled here; `react-native-device-agent` itself lets any consuming app
  enable a different subset.

## Gotcha: this repo merges two unrelated git histories

`main` is the result of merging two git histories that share **no common ancestor**
(`git merge-base` returns nothing between them) — not just a normal divergence.

- One side is the original standalone `react-native-device-agent` harness repo (root commit
  `20f9925`) — the demo app, `example/`, and this AgentFacts card all come from here.
- The other side (`origin/main` at the time of the merge) is a **completely separate git init**
  (root commit `d276404`) containing the actual built-out Host39 monorepo (`server/`, `web/`,
  `mobile/`, Docker/Caddy config) described in `host39_plan.txt`. Per its own
  `packages/react-native-device-agent/UPSTREAM.md`, that side imported a *copy* of this harness
  from `https://github.com/tremblerz/device-agent` at commit `30ca528` and then diverged
  independently (added cancellation, Ajv validation, tests).

Merging required `git merge --allow-unrelated-histories`, which produced real
add/add conflicts (git had no shared base to three-way-diff against) in 12 files. How those
were resolved, in case it comes up again (e.g. a future rebase, or bisecting across the merge
commit):

- **`packages/react-native-device-agent/**` (8 files)** — took `origin/main`'s version
  entirely. Confirmed before merging that the local side had zero changes to this directory
  since the `30ca528` import point, so origin's version (tests, Ajv validation, cancellation
  support) is a strict superset, not a competing edit.
- **Root `package.json`** — kept Host39's identity/scripts (`name: "host39"`, `dev:server`,
  `dev:web`, `android` now means the `mobile` workspace's Android app, **not** the demo). Added
  `"example"` back into `workspaces` and re-exposed the demo app's scripts under an
  `example:*` prefix (`example:start`, `example:ios`, `example:android`, `example:web`) instead
  of the old bare `ios`/`android` names, which now unambiguously mean the Host39 phone app.
- **Root `README.md`** — kept Host39's README as the authoritative doc (it documents the real,
  running product), appended an "Also in this repo" section so `example/`,
  `packages/react-native-device-agent`, and this card stay discoverable.
- **`.gitignore`** — unioned both sides (Host39's server/web/docker ignores + the original
  repo's Expo/native/GGUF-model ignores).
- **`package-lock.json`** — took origin's version, then ran `npm install
  --package-lock-only --workspaces --include-workspace-root` to fold the restored `example`
  workspace back in rather than hand-editing a generated file.

If you're bisecting, blaming, or rebasing across the merge commit, expect normal git history
tools to behave oddly on either side of it — there is no linear relationship between commits
on the two original histories.

## Keeping this in sync

If any of the above changes — a real endpoint ships, the card gets signed, it gets registered
with NANDA, or the tool-group configuration changes — update both `agentfacts.json` and the
`known_limitations`/`schema_deviations` arrays inside it (don't just add the new capability and
leave the old limitation listed). When the Host39 backend described in `host39_plan.txt`
actually exists, expect `id`, `endpoints`, and the signature fields to need real replacement,
not incremental filling-in.
