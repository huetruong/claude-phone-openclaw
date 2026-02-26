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

- **`announce`** — One-way notification. The called party hears the message and the call ends. Use for task completion callbacks, alerts, and status updates.
- **`conversation`** — Two-way call. The called party can speak back. Use for complex discussions, decisions that need input, or follow-up Q&A.

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
2. Optionally ask if they want to link other channels (Discord, email, etc.).
3. Call `link_identity` using the `phone` value from CALLER CONTEXT as `peerId`.
4. Greet them by name going forward.

**Important:** Use the `phone` value from `[CALLER CONTEXT]` directly as `peerId` — do not ask the caller for their phone number.

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

## Error Handling

- **Voice-app unreachable** (`place_call` returns `{ error }`): Inform the user via the primary channel. Do not attempt to call again without user instruction.
- **Enrollment fails** (`link_identity` returns `{ ok: false }`): Let the caller know and continue the conversation without enrollment; retry next call.
