# SIP Voice Channel Skills

This plugin gives you two tools for voice communication and identity enrollment.
Use them as described below.

---

## Tool: `place_call`

Initiates an outbound phone call via the voice-app.

### Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `to`      | string | yes      | Destination phone number (E.164, e.g. `+15551234567`) or extension (e.g. `9001`) |
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
// Task completion callback
place_call({
  to: "+15551234567",
  device: "9000",
  message: "Your research task is done. I found 3 relevant papers and posted the summary to chat.",
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

Enrolls a new caller by linking their phone number to a canonical identity.

### Parameters

| Parameter  | Type     | Required | Description |
|------------|----------|----------|-------------|
| `name`     | string   | yes      | Canonical name for this person (e.g. `"hue"`) |
| `peerId`   | string   | yes      | Their phone number (provided in caller context) |
| `channels` | string[] | no       | Additional channel identifiers (e.g. `["discord:987654321"]`) |

### Return value

On success: `{ ok: true, identity: string }`

### Enrollment flow

Trigger enrollment when you receive `[CALLER CONTEXT: First-time caller, no identity on file]`.

1. Ask the caller for their name.
2. Optionally ask if they want to link other channels (Discord, email, etc.).
3. Call `link_identity` with the collected information.
4. Greet them by name going forward.

### Example

```
// First-time caller enrolled
link_identity({
  name: "hue",
  peerId: "+15551234567",
  channels: ["discord:987654321"]
})
```

---

## Call Continuity

When a caller has an identity on file, you will receive:
`[CALLER CONTEXT: Known caller, identity="hue"]`

- Greet returning callers by name.
- Reference the previous conversation if relevant to the current request.
- Keep voice greetings concise — 1–2 sentences maximum.

---

## Error Handling

- **Voice-app unreachable** (`place_call` returns `{ error }`): Inform the user via the primary channel. Do not attempt to call again without user instruction.
- **Enrollment fails** (`link_identity` returns an error): Let the caller know and continue the conversation without enrollment; retry next call.
