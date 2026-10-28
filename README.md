# Voxora

A Discord-inspired community chat application with a responsive dark interface, five channels, display names, search, persistent messages, and live updates across browser sessions.

## Run

Requires Node.js 20 or newer. No dependencies or credentials are required.

```sh
npm start
```

The server listens on port 3000 (override with `PORT`). Run `npm run check` for JavaScript syntax validation. Messages are stored in the ignored `.data/messages.json` file. Use the gear button to choose a display name, select a channel, and send messages with Enter.

This prototype has no authentication or authorization. Names and seeded member presence are illustrative. Voice calls and additional communities are not implemented. Do not expose it as a production chat service without adding authentication, access control, rate limits, moderation, and a production data store.
