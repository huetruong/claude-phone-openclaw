# SIP Voice Channel Skills

This plugin gives you two tools for voice communication and identity enrollment.
Use them as described below.

---

## Tool: `place_call`

Initiates an outbound phone call via the voice-app.

### Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `to`      | string | yes      | Destination: phone number (E.164, e.g. `+15551234567`), extension (e.g. `9001`), or identity name (e.g. `"operator"`) |
| `device`  | string | yes      | Your extension to call from (e.g. `"9000"`) |
| `message` | string | yes      | Voice message to deliver (TTS, max 1000 chars). Keep it concise — under 50 words is ideal for voice. |
| `mode`    | string | no       | `"announce"` (default) or `"conversation"` |

### Modes

- **`conversation`** — **(default)** Two-way call. The called party can speak back. Use this for all user-initiated "call me back" requests — they may want to ask follow-up questions, give more instructions, or continue the conversation.
- **`announce`** — One-way notification. The called party hears the message and the call ends. Only use this when explicitly asked for a one-way notification (e.g. "just leave me a message", "send me an alert").

### Return value

On success: `{ callId: string, status: string }`
On failure: `{ error: string }`

### Behavioral rules

1. **Always post the full result to the primary channel FIRST**, then call with a brief voice summary.
   - Primary channel (chat/CLI/etc.) gets the complete output.
   - Voice call gets a short spoken summary only.
2. Keep `message` voice-friendly: no markdown, no URLs, no long lists.
3. If `place_call` returns `{ error }`, inform the user via the primary channel — do not retry silently.

### Example usage

```
// Task completion callback — by phone number
place_call({
  to: "+15551234567",
  device: "9000",
  message: "Your research task is done. I found 3 relevant papers and posted the summary to chat.",
  mode: "announce"
})

// Task completion callback — by identity name (resolves to configured phone number)
place_call({
  to: "operator",
  device: "9000",
  message: "Your research task is done. Summary posted to chat.",
  mode: "announce"
})

// Follow-up conversation
place_call({
  to: "+15551234567",
  device: "9000",
  message: "I have a question about the deployment timeline. Do you have a moment to discuss?",
  mode: "conversation"
})
```

---

## Tool: `link_identity`

Enrolls a caller by linking their phone number to a canonical identity.
Multiple callers can be enrolled — each person gets their own identity (owner, partner, etc.).

### Parameters

| Parameter  | Type     | Required | Description |
|------------|----------|----------|-------------|
| `name`     | string   | yes      | Canonical name for this person (e.g. `"hue"`) |
| `peerId`   | string   | yes      | Their phone number — use the `phone` value from `[CALLER CONTEXT]` |
| `channels` | string[] | no       | Additional channel identifiers (e.g. `["discord:987654321"]`) |

### Return value

On success: `{ ok: true, identity: string }`
On failure: `{ ok: false, error: string }`

### Enrollment flow

Trigger enrollment when you receive:
`[CALLER CONTEXT: First-time caller, no identity on file, phone="+15551234567"]`

1. Ask the caller for their name.
2. Check if you already know their identity from another channel (Discord, web UI, etc.). If you do, tell them and confirm: *"I know you as [name] from Discord — want me to link that to this number?"*
3. Collect any additional channels to link (Discord user ID, web UI, etc.).
4. Call `link_identity` using the `phone` value from CALLER CONTEXT as `peerId`, and include all known channels.
5. Greet them by name going forward.

**Important:** Use the `phone` value from `[CALLER CONTEXT]` directly as `peerId` — do not ask the caller for their phone number.

### Re-enrollment flow

If a known caller says "re-enroll me", "link my phone", "update my channels", or similar:

1. Confirm their current identity: *"I have you as [name] — want to update your linked channels?"*
2. Check what channels you already know about (Discord, web UI, etc.) and include them automatically.
3. Ask if there are any additional channels to add.
4. Call `link_identity` with `peerId` from CALLER CONTEXT and the full updated channel list.
5. Confirm: *"Done — your phone is now linked to [channels]. I'll send long responses there and call you back on this number."*

**If you already know the caller from another channel (Discord, web UI), proactively include that channel in `link_identity` without asking — just confirm it with them.**

### Example

```
// First-time caller with phone="+15551234567" enrolled as "hue"
link_identity({
  name: "hue",
  peerId: "+15551234567",
  channels: ["discord:987654321"]
})

// A second caller with phone="+15559876543" enrolled as "alice"
link_identity({
  name: "alice",
  peerId: "+15559876543"
})
```

---

## Call Continuity

When a caller has an identity on file, you will receive:
`[CALLER CONTEXT: Known caller, identity="hue", textChannels=["discord:987654321"]]`

or, if no text channels are linked:
`[CALLER CONTEXT: Known caller, identity="hue", textChannels=none]`

- Greet returning callers by name.
- Reference the previous conversation if relevant to the current request.
- Keep voice greetings concise — 1–2 sentences maximum.
- Use `textChannels` to decide how to deliver long or complex responses (see Voice Response Management below).

---

## Voice Response Management

Voice is low-bandwidth — optimize your responses for spoken delivery.

### Rules

1. **Short response** (≤~40 words, no structured data): Speak the full response. No special formatting needed.
2. **Long response + user has textChannels**: Write the complete full response first, then prefix your voice summary line with `🗣️ VOICE_RESPONSE:`. OpenClaw routes the full response body to the user's primary text channel automatically — your job is to structure the output correctly.
   - Put the `🗣️ VOICE_RESPONSE:` line **first**, followed by the full response content below it.
   - The voice summary must reference the delivery: e.g. "Full report sent to your Discord."
   - Example: `🗣️ VOICE_RESPONSE: Deployment complete, three services updated. Full report sent to your Discord.`
3. **Long response + no textChannels** (`textChannels=none`): Prefix a best-effort truncated summary with `🗣️ VOICE_RESPONSE:` and inform the user. No full response body needed since there is no channel to route it to.
   Example: `🗣️ VOICE_RESPONSE: Deployment complete with three service updates. I have more detail, but you don't have a text channel linked. Say "link identity" to add one.`

### What counts as "long or complex"

- More than ~40 words
- Contains lists, tables, diffs, code, metrics, or URLs
- Contains markdown formatting the caller can't hear

### Examples

**Short — speak fully:**
```
The server is healthy. CPU at 12%, memory at 45%.
```

**Long — with text channels:**
```
🗣️ VOICE_RESPONSE: Your research task is done. I found 3 papers and posted the full summary with links to your Discord.

[Full detailed response with markdown, links, citations...]
```

**Long — no text channels:**
```
🗣️ VOICE_RESPONSE: Your research task is done. I found 3 relevant papers. I can't send the details since you don't have a text channel linked — say "link identity" to add Discord or another channel.
```

---

## Async Task Pattern (Voice)

Voice queries have a 90-second limit. For tasks that take longer, or when the caller says
"call me when done" / "call me with the result" / "call me back", use the async pattern:

### Before dispatching — resolve ambiguity first

If you need more information to complete the task, **ask on the inbound call** before dispatching.
Do not call back to ask follow-up questions that could have been resolved upfront.

Examples:
- *"Call me with the weather"* → Which city? Ask now if unclear.
- *"Call me when the task is done"* → Which task? Confirm before hanging up.
- *"Call me in a bit"* → Anything else you need from them? Ask now.

Once you have everything you need, dispatch immediately.

### Dispatch pattern

1. Launch the work as a background process with `nohup ... &` so the exec returns immediately.
2. **Stay on the inbound call.** Confirm the task is queued and ask if there's anything else:
   *"Got it — I've queued that up and I'll call you right back with the result. Is there anything else while I have you?"*
3. Let the caller finish. When they're done, say goodbye — **include "bye"** to trigger hangup.
4. The background process calls back in conversation mode so they can ask follow-ups.

**Do not say "bye" immediately after dispatching.** Stay on the call, confirm, and ask "anything else?" first.
Only say "bye" once the caller is actually ready to hang up.

### Timing variants

| What the caller says | What to do |
|---|---|
| "call me back" / "call me right away" | Dispatch nohup immediately, no sleep |
| "call me in 5 minutes" | Add `sleep 300` before the work in the nohup script |
| "call me in an hour" | Add `sleep 3600` before the work |
| "call me when done" | Dispatch immediately, work runs first, then callback |

### Background script template

```bash
# Read plugin config to get voiceAppUrl and apiKey
VOICE_APP_URL=$(python3 -c "import json; c=json.load(open('/home/dewey/.openclaw/openclaw.json')); p=c['plugins']['entries']['openclaw-sip-voice']['config']; print(p['voiceAppUrl'])")
API_KEY=$(python3 -c "import json; c=json.load(open('/home/dewey/.openclaw/openclaw.json')); p=c['plugins']['entries']['openclaw-sip-voice']['config']; print(p['apiKey'])")

# Build the work + callback script
nohup bash -c "
  RESULT=\$(... your command here ...)
  curl -s -X POST \$VOICE_APP_URL/api/outbound-call \
    -H 'Content-Type: application/json' \
    -H \"Authorization: Bearer \$API_KEY\" \
    -d \"{\\\"to\\\": \\\"CALLER_PHONE\\\", \\\"device\\\": \\\"DEVICE\\\", \\\"message\\\": \\\"\$RESULT\\\"}\"
" > /tmp/voice-callback-\$(date +%s).log 2>&1 &
```

Replace `CALLER_PHONE` with the `phone` value from `[CALLER CONTEXT]`.
Replace `DEVICE` with the `device` value from `[CALLER CONTEXT]` (e.g. `9000`).

**Important:** The `to` field in the background script must be a phone number (E.164 format like `+15551234567`),
NOT an identity name like `"alice"`. The voice-app outbound API does not resolve identity names.
Always use the `phone` value from `[CALLER CONTEXT: First-time caller ... phone="..."]` or the
phone number you stored when enrolling via `link_identity`.

### When to use this pattern

| Situation | Pattern |
|-----------|---------|
| "How's the weather?" (can answer in < 90s) | Inline — fetch and speak the result |
| "Research X and call me when done" | Async — launch background job, call back |
| "Call me in 10 minutes" | Async — use `sleep 600` in background script |
| "Check the server and call me" | Async — run check, call back with result |

### Example: "call me with the weather"

```bash
nohup bash -c '
  WEATHER=$(curl -s "https://api.open-meteo.com/v1/forecast?latitude=34.05&longitude=-118.24&current=temperature_2m,weather_code&temperature_unit=fahrenheit&forecast_days=1" | python3 -c "import json,sys; d=json.load(sys.stdin); c=d[\"current\"]; print(f\"{c[\"temperature_2m\"]}F\")")
  VOICE_APP_URL=$(python3 -c "import json; c=json.load(open(\"/home/dewey/.openclaw/openclaw.json\")); print(c[\"plugins\"][\"entries\"][\"openclaw-sip-voice\"][\"config\"][\"voiceAppUrl\"])")
  API_KEY=$(python3 -c "import json; c=json.load(open(\"/home/dewey/.openclaw/openclaw.json\")); print(c[\"plugins\"][\"entries\"][\"openclaw-sip-voice\"][\"config\"][\"apiKey\"])")
  curl -s -X POST "$VOICE_APP_URL/api/outbound-call" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "{\"to\": \"+15551234567\", \"device\": \"9000\", \"message\": \"Hey, here's the New York weather: $WEATHER. Anything else you need?\"}"
' > /tmp/voice-cb-weather.log 2>&1 &
```

Then respond to the caller: *"I'll grab the weather and ring you right back — bye for now!"*

**Always include "bye" or "goodbye"** when dispatching a callback — the voice-app detects it and hangs up automatically so the caller doesn't have to wait on the line.

---

## Discord-Initiated Callbacks

When a user asks to be called from **Discord** (e.g. "call me", "call me in 5 minutes", "ring me with the weather"):

1. **Check identity links first** — before asking for a phone number, look up the caller's Discord ID in `session.identityLinks` (in the OpenClaw config). Find the entry where `discord:THEIR_DISCORD_USER_ID` is listed, then read the `sip-voice:` channel from the same entry to get their phone number.

2. **If found** — use it silently. Do not ask for their number. Proceed directly to scheduling the call.
   - Example: Discord user `discord:123456789` is linked → `sip-voice:15551234567` → call `+15551234567`

3. **If not found** — ask for their phone number and device/extension, then offer to save it:
   *"I don't have your number on file — what's the best number to reach you? I can save it so you don't have to tell me again."*

4. **Device** — use the `device` from their identity link if present, otherwise use the default extension (e.g. `9000`).

**Never ask for a phone number if you can resolve it from identity links.**

---

## Error Handling

- **Voice-app unreachable** (`place_call` returns `{ error }`): Inform the user via the primary channel. Do not attempt to call again without user instruction.
- **Enrollment fails** (`link_identity` returns `{ ok: false }`): Let the caller know and continue the conversation without enrollment; retry next call.
