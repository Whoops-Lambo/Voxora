# Put public Voxora on Render

This runs one shared Voxora backend. Everyone connects to its HTTPS address, creates an account and chats with the other users on that service. Users do not need to host anything. Accounts, messages, pictures and bot configuration stay on one persistent disk; there is no separate database to configure.

## Create your Render account

1. Open [Render signup](https://dashboard.render.com/register).
2. Select **Sign up with GitHub** and sign in with the account that owns the Voxora repository.
3. Finish the email verification or onboarding Render requests and open your personal workspace/dashboard.

A Render account does not by itself create a paid service. This deployment uses a **Starter web service plus a 1 GB persistent disk**. Review the current monthly total in Render before selecting Deploy. The free web-service instance sleeps when inactive and cannot attach the persistent disk required for Voxora's file storage.

## Deploy the service

Open **[Deploy Voxora to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FWhoops-Lambo%2FVoxora)**.

The repository's `render.yaml` configures:

- One Docker web service named `voxora-public` on the Starter instance plan.
- A persistent 1 GB disk mounted at `/data`.
- The command `node public-server.js` and health check `/api/info`.
- An initial owner username of `voxora_owner` and display name Voxora Owner.
- A randomly generated, private `VOXORA_OWNER_PASSWORD`.
- Automatic deployments from main for new Blueprints. Existing services must enable Auto-Deploy → On Commit in Render Settings; changing the YAML does not itself update an existing service setting.

Review the service and disk cost, then select **Deploy** or **Deploy Blueprint**, as labeled in the dashboard. If Render asks for GitHub repository access, only Voxora is needed. Wait until the service is Live. Use the HTTPS address Render actually assigns; do not guess the hostname. No voxora.com domain is required.

If you create a web service manually instead of using the Blueprint, use the settings above, including the **Docker Command** `node public-server.js`, disk and owner variables. The ordinary Docker command starts the unconfigured backend and is intended for separately controlled setup.

## Sign in as the owner

1. Open the deployed service in Render and select **Environment**.
2. Reveal/copy `VOXORA_OWNER_PASSWORD` privately in your own dashboard.
3. Open the service's HTTPS address followed by `/app`.
4. Sign in as **`voxora_owner`** using that generated password. This account owns Platform Admin.
5. Register a separate ordinary user and confirm it has no platform staff role. Other people register their own accounts at the same address.

Do not post the owner password in GitHub, screenshots or chat. The launcher creates this first account while the backend is bound only to loopback, then opens the public listener. It stops rather than expose an unclaimed owner account if initial setup fails. The password is hashed in the saved account state; owner environment variables are not forwarded into the serving backend process.

An existing valid owner is retained on redeployment. Changing the bootstrap environment variables does not replace an existing account, reset its password, or grant another user ownership. A missing/corrupt persisted owner stops public startup and requires recovery from the existing data.

## Connect the Windows app

In Voxora, open **User Settings → Server Connection → Change Server**, or press Alt and use **Voxora → Server Connection**. Enter the service's actual HTTPS address and select Connect. Sign in or register on that shared service. Every person uses the same address.

Local Workspace accounts are separate from the new public service. They are preserved on the PC. Existing local accounts do not automatically migrate or merge. To migrate a workspace, restore its complete chat-data directory to the service's persistent disk before opening it to other users; its existing owner remains authoritative.

Voxora 3.2.1 defaults new desktop installs to **https://voxora-public.onrender.com**. Existing installs keep their saved connection. Use **Voxora → Join Public Voxora** (press Alt for the menu) or the public-service button on Server Connection to switch explicitly. Startup never replaces earlier local data or silently hosts a private platform when the public service is unavailable. `Voxora.exe --voxora-connection-setup` opens connection choices without automatically reconnecting.

For a bot created on this service, set `VOXORA_URL=https://voxora-public.onrender.com` in its private `.env` and use the token issued by this service's Developer Portal. Keep tokens private.

## Updates, storage and recovery

The service tracks the GitHub main branch. Enable **Settings → Auto-Deploy → On Commit** to deploy pushed backend fixes, or use **Manual Deploy → Deploy latest commit**. Installing a desktop update alone does not update the hosted interface. After deploying 3.3.0, `/api/info` reports `realtimeSync: true`. Keep the same persistent disk and data path. File-based Voxora must run as one instance; do not attach independent writable copies of its state to multiple replicas.

Back up the complete disk, including `state.json`, `uploads`, `profile-images` and `emojis`. Render's available snapshot/backup tools depend on its current plan. Deleting the service or disk can delete its saved data; retaining source code alone does not retain chat history.

Stripe purchases remain disabled until you supply the Stripe settings from [Voxora Plus](PLUS.md). Voice/video use the existing WebRTC configuration; networks that require a media relay still need a TURN service configured separately. Neither paid billing nor TURN is provisioned by this Blueprint.

The public health check is `/api/info`. Before announcing the service, confirm it returns Voxora metadata and that a second account is an ordinary user. Keep the owner password and deployment/API credentials in Render's private settings.
