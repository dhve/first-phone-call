# Upstream provenance

This package is an internal copy of `react-native-device-agent`, imported as
monorepo source. It is consumed by the `mobile` workspace via the package name
`react-native-device-agent`; Metro watches and transpiles this workspace source
directly.

- Original repository: https://github.com/tremblerz/device-agent
- Imported path: `packages/react-native-device-agent`
- Imported commit: `30ca528` (main, July 2026)
- Excluded from import: the upstream demo application (`example/`)
- Upstream had no LICENSE file and no test suite at the imported commit; tests
  added here are original to this repository. Because upstream ships no
  license grant, this package declares "UNLICENSED" and must remain private
  until upstream adds a license we can inherit.

There is intentionally no publishing, submodule, or synchronization machinery
for this copy. If a future upstream release ships through a package manager
with compatible interfaces (`Agent`, `LlamaEngine`, `ToolRegistry`,
`defineTool`), it may replace this internal copy.

Local modifications are tracked in this repository's git history from the
import commit onward.
