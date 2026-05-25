## Variant: Admin Command Centre

### Design stance
A live-event control room: the current output and emergency actions are always obvious, while settings such as the admin PIN are still easy to reach.

### Key choices
- Layout: persistent left sidebar plus live dashboard content area.
- Priority: large “Now showing” card, then next/previous/blank controls.
- Security concept: Admin PIN is a settings card inside the admin panel, but saving a new PIN should require the current PIN/server-side admin authentication.
- Visual feel: dark, calm, mosque-friendly, less plain than the current form layout.

### PIN behaviour concept
- First-time setup can still use `.env`/default config.
- After logging into `/admin`, an authorised admin can change the PIN in the UI.
- The server stores the new PIN in a local config file, not in browser-only state.
- All admin API/WebSocket commands use the latest PIN.
- No token system.

### Trade-offs
- Strong at: live-event operation, quick scanning, large touch targets.
- Weak at: dense configuration screens; it prioritises control-room use over spreadsheet-style admin.

### Best for
Mosque/event use where someone needs to confidently control the display during a live programme from a laptop or tablet.
