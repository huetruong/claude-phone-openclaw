# Story 2.4: CLI Device Add accountId Support

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want the `claude-phone device add` command to prompt for an `accountId` field,
so that new devices are OpenClaw-ready without manual JSON editing.

## Acceptance Criteria

1. **Given** the operator runs `claude-phone device add`, **When** the interactive prompts are presented, **Then** a new prompt asks for `accountId` after the existing `name` field, defaulting to the device `name` (lowercased) if left blank.

2. **Given** the operator provides an `accountId` value during `device add`, **When** the device is saved to `~/.claude-phone/config.json`, **Then** the device object includes `"accountId": "<value>"` alongside the existing fields.

3. **Given** the operator leaves `accountId` blank during `device add`, **When** the device is saved, **Then** the device object includes `"accountId": "<name>"` using the device name (lowercased, trimmed) as fallback (consistent with Story 2.1 voice-app fallback behavior).

4. **Given** the operator runs `claude-phone device list`, **When** the device table is displayed, **Then** the table includes an `Account ID` column showing each device's `accountId` value.

5. **Given** `devices.json` is generated or updated from CLI config (via `claude-phone start`), **When** the docker config is written, **Then** each device entry in `devices.json` includes the `accountId` field from the CLI config. (No code change needed — `start.js` passes full device object as-is.)

## Tasks / Subtasks

- [x] Task 1: Add `accountId` prompt to `device add` command (AC: #1, #2, #3)
  - [x] 1.1 Add `accountId` inquirer prompt in `cli/lib/commands/device/add.js` after `name` prompt
  - [x] 1.2 Default value: `answers.name.trim().toLowerCase()` when left blank
  - [x] 1.3 Include `accountId` in the `newDevice` object literal
- [x] Task 2: Add `accountId` prompt to setup wizard (AC: #2, #3)
  - [x] 2.1 Add `accountId` prompt in `cli/lib/commands/setup.js` `setupDevice()` function (around line 1022-1029 where device object is constructed)
  - [x] 2.2 Same default behavior as `device add`
- [x] Task 3: Add `Account ID` column to `device list` (AC: #4)
  - [x] 3.1 Update ASCII box table in `cli/lib/commands/device/list.js` to include `Account ID` column
  - [x] 3.2 Dynamic or fixed width — match existing column style
  - [x] 3.3 Show `device.accountId` value (fallback to `device.name` for backward compat display)
- [x] Task 4: Update tests (AC: #1-#4)
  - [x] 4.1 Add `accountId` field to test device fixtures in `cli/test/device.test.js`
  - [x] 4.2 Add test: `accountId` is included in saved device when provided
  - [x] 4.3 Add test: `accountId` defaults to device name when left blank
  - [x] 4.4 Add test: `device list` displays `Account ID` column
- [x] Task 5: Verify devices.json passthrough (AC: #5)
  - [x] 5.1 Verify `start.js` devices.json generation includes `accountId` (no code change expected — just confirm)

## Dev Notes

### Architecture & Constraints

- **CommonJS only** — the CLI uses `require`/`module.exports` throughout
- **No new dependencies** — use existing `inquirer` for prompts, existing ASCII table builder for list
- **Backward compatibility** — existing devices in `~/.claude-phone/config.json` that lack `accountId` must not break; display `name` as fallback in `device list`
- **Consistency with Story 2.1** — voice-app's `DeviceRegistry` already falls back to `device.name` when `accountId` is absent (with a warning log). The CLI should match this fallback behavior for the default value.

### Key File Locations

| File | Purpose | Change Type |
|------|---------|-------------|
| `cli/lib/commands/device/add.js` | Device add interactive flow | Add prompt + field |
| `cli/lib/commands/device/list.js` | Device list ASCII table | Add column |
| `cli/lib/commands/setup.js` | Setup wizard `setupDevice()` | Add prompt + field |
| `cli/test/device.test.js` | Device command tests | Add test cases + fixtures |
| `cli/lib/commands/start.js` | Writes devices.json to voice-app | No change needed (verify only) |

### Implementation Details

**`add.js` — Prompt insertion point:**
The current prompt order is: `name` → `extension` → `authId` → `password` → `voiceId` → `prompt`. Insert `accountId` after `name`:

```js
{
  type: 'input',
  name: 'accountId',
  message: 'Account ID (OpenClaw agent binding):',
  default: (answers) => answers.name.trim().toLowerCase(),
}
```

**`add.js` — newDevice object (currently at ~line 67):**
```js
const newDevice = {
  name: answers.name.trim(),
  accountId: answers.accountId || answers.name.trim().toLowerCase(),
  extension: answers.extension,
  // ... rest unchanged
};
```

**`list.js` — Table column addition:**
Current columns: `Name` (dynamic), `Extension` (9), `Voice ID` (30). Add `Account ID` column with dynamic width similar to `Name`.

**`start.js` — devices.json generation (lines 151-157, 273-279):**
```js
for (const device of config.devices) {
  devicesConfig[device.extension] = device;  // passes ALL fields including accountId
}
```
No change needed — accountId flows through automatically once present in config.

### Previous Story Intelligence

**From Story 2.1 (Device Configuration with accountId):**
- `DeviceRegistry.load()` in voice-app already handles missing accountId with fallback to `device.name`
- Pattern: `if (!device.accountId) { device.accountId = device.name; logger.warn(...) }`
- Tests use `node:test` + `node:assert`
- 29 tests passed at end of Story 2.1

**From Story 2.2 (Plugin Agent Bindings):**
- Minimal code changes preferred — add only what the ACs require
- Code review strengthened assertions (avoid fragile string matching)
- 204 total tests pass (96 cli + 30 voice-app + 78 plugin)

### Git Intelligence

- Branch naming: `feature/story-2-4-cli-device-add-accountid-support` (already created)
- Commit format: `feat(story-2-4): CLI device add accountId support`
- Recent patterns show feature commits followed by code review fix commits

### Project Structure Notes

- CLI tests are at `cli/test/device.test.js` — tests for add, list, remove commands
- Config file at `~/.claude-phone/config.json` with `mode: 0o600` (secure permissions)
- Config has `.backup` created before each save via `saveConfig()` in `cli/lib/config.js`
- No alignment conflicts detected — CLI is independent of voice-app and plugin code

### Testing Standards

- Framework: `node:test` + `node:assert` (CommonJS, no Jest)
- Run: `npm test` at repo root or `npm run test:cli` for CLI tests only
- Mock pattern: mock `inquirer.prompt`, `config.loadConfig`, `config.saveConfig` as needed
- 96 CLI tests currently passing — do not regress

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Configuration Schema]
- [Source: _bmad-output/planning-artifacts/prd.md#FR28]
- [Source: cli/lib/commands/device/add.js — device add command handler]
- [Source: cli/lib/commands/device/list.js — device list table renderer]
- [Source: cli/lib/commands/setup.js — setup wizard setupDevice()]
- [Source: cli/lib/commands/start.js — devices.json generation]
- [Source: cli/test/device.test.js — device command test suite]
- [Source: voice-app/lib/device-registry.js — accountId fallback logic (Story 2.1)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Added `accountId` inquirer prompt to `device add` after `name` field; defaults to `name.trim().toLowerCase()` when blank
- Added `accountId` field to `newDevice` object in `add.js` with fallback: `answers.accountId || answers.name.trim().toLowerCase()`
- Added same `accountId` prompt and field in `setup.js` `setupDevice()` function for consistency
- Updated `list.js` ASCII table: added `Account ID` column with dynamic width (min 10); fallback to `device.name` for backward compat
- Updated `horizontalLine` width calculation to account for new column (+3 for `│ ` separator)
- Added 4 new tests to `device.test.js`: accountId fixture, provided value, blank fallback, list column fallback
- Verified `start.js` devices.json generation passes full device object — `accountId` flows through automatically; no code change needed
- Full test suite: 208 tests pass (100 CLI + 30 voice-app + 78 plugin), 0 failures, 0 regressions

### File List

- cli/lib/commands/device/add.js
- cli/lib/commands/device/list.js
- cli/lib/commands/setup.js
- cli/test/device.test.js

### Change Log

- feat(story-2-4): Added `accountId` prompt to `device add` and setup wizard; added `Account ID` column to `device list`; 4 new tests added; all 208 tests pass
