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

## Keeping this in sync

If any of the above changes — a real endpoint ships, the card gets signed, it gets registered
with NANDA, or the tool-group configuration changes — update both `agentfacts.json` and the
`known_limitations`/`schema_deviations` arrays inside it (don't just add the new capability and
leave the old limitation listed). When the Host39 backend described in `host39_plan.txt`
actually exists, expect `id`, `endpoints`, and the signature fields to need real replacement,
not incremental filling-in.
