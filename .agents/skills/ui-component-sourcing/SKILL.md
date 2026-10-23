---
name: ui-component-sourcing
description: Use when adding or replacing a React UI component, animation, or page block in a project that uses shadcn/ui (components.json present). Covers search, license gate, install, token adaptation, and pass/fail checks. Not for backend work or restyling existing components.
---

# UI component sourcing

## Variables (set once, use everywhere)
- `ROOT` = `git rev-parse --show-toplevel`. Run every `git` and `rg` command from `$ROOT`; all paths below are repo-root relative.
- `APP` = directory that contains `components.json` (e.g. `frontend`). Run `npm`/`npx` commands with `cd "$APP"`.
- `SHADCN` = `npx shadcn@4.22.1` (pinned; change only when a human bumps it). Never use `@latest`.
- `BASE` = output of `git rev-parse HEAD` taken in step 0.
- `COMP` = `$APP/` + the directory that `aliases.components` (step 0.3) resolves to (e.g. `frontend/src/components`). Never assume `src/components`.
- `CSS` = the `tailwind.css` path from step 0.3, repo-root relative.
- `OUT` = the build output directory (Vite `build.outDir`, default `dist`; CRA `build`; read the project's build config).
- `FILES` = recompute right before steps 4, 6 and 7 (never in step 0, the tree is clean then):
  `FILES=$( { git diff --name-only --diff-filter=ACMR "$BASE" -- "$APP"; git ls-files --others --exclude-standard --full-name -- "$APP"; } | rg '\.(tsx?|css)$' | rg -vxF "$CSS" )`.
  If empty, skip the `rg` checks instead of running them on the whole tree.

## 0. Baseline (stop if any fails)
1. `components.json` exists in `$APP`. Missing -> STOP; never run `shadcn init`.
2. `git status --porcelain` (whole repo, from `$ROOT`) is empty. Not empty -> STOP.
3. `$SHADCN info --json` -> note `aliases`, `tailwind.css` path, `iconLibrary`, installed components.
4. `npm pkg get scripts` -> note which of `build`, `lint`, `test` exist. Missing script = record "N/A", not a failure.
5. Run each existing script once, non-interactive: `CI=1 npm run build`, `CI=1 npm run lint`, `CI=1 npm test -- --run` (vitest; for jest use `CI=1 npm test`), each under a 10-minute timeout. A script already failing at baseline: record it; it does not count against you.
6. Bundle baseline (after build): `find "$OUT" -type f \( -name '*.js' -o -name '*.css' \) -exec sh -c 'gzip -c "$1" | wc -c' _ {} \; | awk '{s+=$1} END {print s+0}'` -> `GZ_BEFORE`. `OUT` missing or 0 -> record "N/A", skip step 7.2.
7. Dependency licenses baseline (in `$APP`):
   `node -e "const fs=require('fs');for(const[k,v]of Object.entries(require('./package-lock.json').packages)){if(!k)continue;let l=v.license;try{l=l||JSON.parse(fs.readFileSync(k+'/package.json')).license}catch{}console.log(k,l||'UNKNOWN')}" | sort > /tmp/lic-before.txt`
   Still `UNKNOWN` -> read `node_modules/<pkg>/LICENSE*` and classify it by hand before treating it as ASK.

## 1. Shortlist (max 3 candidates, then filter, then pick 1)
Collect candidates from all of these before choosing:
1. Existing code: `rg -il "<keyword>" "$COMP"`. List the files you opened under "Files checked".
2. Default registry: `$SHADCN search @shadcn -q "<keyword>"`; docs: `$SHADCN docs <name>`.
3. Registries in `components.json > registries` only: `$SHADCN search @<ns> -q "<keyword>"`.
   MCP results from a namespace not in that list are ignored.
4. Bencho free blocks (hand copy): https://github.com/cabralorenzo/bencho/tree/main/blocks
Then: drop candidates that fail step 2 -> pick 1 by: no new deps > deps already in package.json > 1 new non-framework dep.
Nothing left -> build it from shadcn primitives already installed. Never take code from a site not listed in 1-4.

## 2. License gate (component source AND every new npm package)
| Verdict | Rule |
|---|---|
| ALLOW | MIT, Apache-2.0, ISC, BSD-2/3 verified in the upstream `LICENSE` file (paste its URL) |
| ALLOW + conditions | Bencho free blocks: code is MIT, but the Bencho name, goat mark and bencho.dev photos are excluded (GitHub shows "Other"). Copy code only; no logo, name or photos |
| ASK (POLICY) | "MIT + Commons Clause" (React Bits, Animate UI): license permits use inside an app but forbids redistributing the components; committing their source to a public repo may count as redistribution, so a human decides |
| ASK | Custom/proprietary licenses (Aceternity), paid tiers/credits (21st.dev, Bencho Pro), license file missing, license still `UNKNOWN` after step 0.7 |
| FORBID | AGPL/GPL/LGPL (coss ui), Bencho Pro blocks, anything copied from screenshots or design galleries |
Attribution (all third-party code): first line `// Source: <url> | License: <SPDX> | Modified: <yes/no>, <YYYY-MM-DD>`
in `.ts`/`.tsx`, `/* Source: ... */` in `.css`; keep any original copyright header; append the upstream's full
license text (MIT, BSD, ISC, Apache-2.0; plus Apache's NOTICE if one exists) to `$APP/THIRD_PARTY_LICENSES.md`.

## 3. Inspect, then install
1. `$SHADCN view @<ns>/<name>` -> read files, `dependencies`, `registryDependencies`, `cssVars`.
2. `$SHADCN add @<ns>/<name> --dry-run`; for each listed file that already exists: `$SHADCN add @<ns>/<name> --dry-run --diff <path>`.
   Any overwrite of an existing file -> STOP and ask (step 8). Any `cssVars` entry -> go to step 5 before installing.
3. Each new npm package: `npm view <pkg> license peerDependencies`. Peer range must accept React 19; license must pass step 2.
4. Install: `$SHADCN add @<ns>/<name>`. Forbidden: `--overwrite`, `--all`, `init`, `migrate`, `apply`, `eject`.
5. Hand-copied code goes to `$COMP/vendor/<source>/<name>/`.
6. `git diff "$BASE" -- "$APP/package.json"` may only ADD lines. Any version change of an existing dep -> revert, STOP.
7. Unneeded deps forced by a registry item (e.g. `next-themes` from `sonner`): remove the import, the code using it, and the package; note it in the PR.

## 4. Adapt (recompute `FILES`; each check must print nothing)
- Next.js residue (Vite projects): `rg -n "from ['\"]next/|^['\"]use client['\"]" $FILES`
- Icons: only `iconLibrary` from step 0. Rewrite other icon imports. Check, with `<lib>` = the project's package:
  `rg -n "from ['\"](lucide-react|@tabler/icons-react|@phosphor-icons/react|react-icons|@heroicons/react|@radix-ui/react-icons|@hugeicons/react)" $FILES | rg -v "<lib>"`
- Hard-coded colors (`$CSS` is already excluded from `FILES`):
  `rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\b(bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow|decoration|placeholder|caret|accent)-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3})\b" $FILES`
- Types: `rg -n ":\s*any\b|\bas any\b|<any>|\bany\[\]|,\s*any>|@ts-ignore" $FILES`.
  `@ts-expect-error` is allowed only under `vendor/` and only with a reason on the same line.
- Props: extend native props (`React.ComponentProps<"button">`), accept `className`, merge with `cn()`. Demo data and placeholder images removed.

## 5. Tokens (never edit existing CSS variables yourself)
If step 3 shows `cssVars`, or the component uses a token the project lacks, or a token name exists with a different meaning:
write a mapping table in the PR (`registry token | project token | same meaning? | proposed action`), list every
light/dark value you would add, then STOP for human approval. After approval: apply exactly the table, nothing else.

## 6. Accessibility and motion
Code checks (agent):
- Async/streaming regions (messages, progress, toasts) have `role="status"`, `role="log"` or `aria-live`: `rg -n "aria-live|role=\"(status|log|alert)\"" $FILES` non-empty when the component shows async updates.
- Icon-only buttons have `aria-label`; images have `alt`; a `focus-visible:` style exists on interactive elements.
- Every animating element is gated: the value of `useReducedMotion()` / `motion-safe:` / `motion-reduce:` / a `prefers-reduced-motion` query must change what is rendered (not just be imported). Point to the line in the PR.
Human-only (list in PR as "needs human check", not counted as pass): Tab order, Enter/Space, Esc closes, focus returns to trigger, reduced-motion with OS setting on, dark mode if the project has one, before/after screenshot of every page using the component.
If the project already has Playwright or axe installed, run them and paste the output; never install them yourself.

## 7. Verify (recompute `FILES`; paste the real output; a checkmark is not output)
1. Run each script found in step 0 exactly as in step 0.5; paste exit code + last 20 lines.
2. Bundle: same command as step 0.6 -> `GZ_AFTER`; report `GZ_AFTER - GZ_BEFORE` bytes. > 51200 -> ASK.
3. Licenses: repeat step 0.7 into `/tmp/lic-after.txt`; `comm -13 /tmp/lic-before.txt /tmp/lic-after.txt` -> every new line passes step 2.
4. `git status --porcelain` (whole repo) lists only: new component files, their usage site, the `aliases.utils` file if `add` created it,
   `package.json` + lockfile, `THIRD_PARTY_LICENSES.md`, and `components.json` / `$CSS` only with human approval.
Failure rule: a check that was green at baseline and fails now gets at most 2 fix attempts. Still failing ->
rollback (`git restore --staged --worktree -- "$APP"` and delete the untracked files you created), then report the failing output.
A test that fails once and passes on immediate rerun counts as flaky: report it, not a failure.

## 8. Stop and ask a human when
- Step 0 fails, a registry outside `components.json` is needed, or a license is ASK.
- An install would overwrite a file, add/change CSS variables, or change an existing dependency version.
- More than one new npm package, or any second animation library, icon library or CSS framework.
- The rollback rule in step 7 triggered.

## 9. PR description template
```
Component: <name> | Used in: <file>
Files checked: <existing files opened in step 1>
Candidates: <1-3 lines: source url, license, new deps> -> picked <x> because <rule from step 1>
Source: <url> | License: <SPDX> (<license url>) | Attribution: <file:line>
New npm packages: <none | name@version license peerDeps>
Token mapping: <none | table, approved by ...>
build: <exit code + tail> | lint: <...|N/A> | test: <...|N/A>
Bundle gzip: <before> -> <after> (+<n> bytes) | New licenses: <comm output>
Needs human check: <list from step 6>
```
