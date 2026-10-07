# Discord Menu Bot

A multi-school Discord dining app with lunch and dinner menus, scheduled reminders, and persistent entrée ratings. Runs on Cloudflare Workers and D1 using Discord HTTP interactions; no continuously running server or Gateway connection is required.

## Install the hosted app

[Install Discord Menu Bot](https://discord.com/oauth2/authorize?client_id=1547379813101076513)

Choose **Add to My Apps** for personal use or **Add to Server** for a shared server. Server installation requires permission to manage the server. Run `/setup` after installation to select your school and notification times.

Personal DM reminders also require Discord to allow the bot to send you direct messages. Setup checks delivery; if Discord blocks it, your school remains saved and reminders are disabled until you retry setup. Personal installation alone does not guarantee DM access.

## Supported schools

| School | Menu selection | Local timezone |
| --- | --- | --- |
| Western Reserve Academy | First three public weekly menu slides; BRAVO, Pioneer Plates and Inspired Eats; exclude V2 and everyday staples | America/New_York |
| St. Paul's School | Coit Entrée, Sides, Dessert; weekday lunch also includes Grab ’n Go Deli Bar sandwiches | America/New_York |
| The Loomis Chaffee School | Grill Main: first item as Entrée, remaining items as Sides | America/New_York |
| Phillips Academy Andover | Paresky Dining, 2nd Floor Home Zone | America/New_York |
| Groton School | Main entrée, sides, and dessert from the main meal | America/New_York |
| The Lawrenceville School | Published daily lunch/dinner main items and sides | America/New_York |
| Deerfield Academy | Main entrée, sides, and dessert | America/New_York |
| Cate School | Hot Lunch/Dinner Offerings | America/Los_Angeles |
| The Taft School | Horace Dutton Taft, Home Zone | America/New_York |
| Peddie School | Published lunch/dinner menu events | America/New_York |

Selections focus on the main meal, excluding unrelated stations and special accommodation sections. Where sources lack explicit categories, conservative rules infer mains and sides. Availability depends on the dates published by each school. See [School sources and parsing rules](SCHOOL_SOURCES.md) for source links and limitations. Sources were checked on October 6, 2026.

## Quick start

For personal use:

```text
/setup school:<your school> scope:Personal lunch_notification:07:00 dinner_notification:15:00 reminders:true
```

For a server (requires Manage Server permission):

```text
/setup school:<your school> scope:Server channel:<menu channel> lunch_notification:07:00 dinner_notification:15:00 reminders:true
```

Use the Discord option picker to enter these values. The bot needs View Channel, Send Messages, and Embed Links permissions in the selected text channel.

Lunch reminders run Monday–Friday for Western Reserve Academy and Loomis, and Monday–Saturday for the other schools by default. No Sunday lunch or brunch notification is sent. A Saturday with a published brunch replacing an absent lunch is also skipped when the source exposes that meal information. Dinner reminders run daily. Times use the school's local timezone and adjust for daylight saving time. Defaults are 07:00 for lunch and 15:00 for dinner. Set `reminders:false` with `/setup` to disable notifications.

## Western Reserve weekly menu

The app exports only the first three slides of the public menu deck: Breakfast, Lunch & Brunch, and Dinner. It caches their table data in D1. Every Monday, starting at **06:00 America/New_York**, it retries fetching the current weekly menu before 07:00. If the school has not published the new week or Google is unavailable, it cannot guarantee completion before 07:00. It rejects a mismatched week instead of using the previous week's menu. Queries can fetch the deck on demand if no matching cached week exists.

The current deck labels Saturday and Sunday lunch as brunch, so WRA receives weekday lunch reminders only, with dinner reminders daily. Menus still use the existing Entrée/Sides/Dessert display and rating buttons. Classification is based on dish names inside BRAVO, Pioneer Plates, and Inspired Eats; vegetarian V2 and everyday staples are excluded. Breakfast and brunch query behavior is unchanged.

Self-hosted existing installations must create the `menu_cache` table using `migrate-menu-cache.sql` before deploying this update. Fresh installations use `schema.sql`.

## Commands

| Command | Options | Behavior |
| --- | --- | --- |
| `/setup` | `school` (required), `scope`, `lunch_notification`, `dinner_notification`, `channel`, `reminders` | Select a school and configure personal or server reminders; reply is private |
| `/food` | `meal`, `date` | Display lunch or dinner with historical ratings |
| `/votes` | None | Show saved vote states for today's and the previous two days' menu dates; visible only to the requester, available to everyone |

Examples:

```text
/food meal:lunch
/food meal:dinner date:10/06
/votes
```

Dates use **MM/DD**, with the current year, within 31 days of today. Without a date, `/food` uses today in school time. Without a meal, it selects lunch before 14:00 and dinner afterward. In a configured server, queries use that server's school; otherwise they use your personal school. Use the bot's DM for personal queries. Menu queries are generally visible in the channel where invoked.

Breakfast and brunch queries reply:

```text
bro they're literally the same thing every time, currently not supported
```

Scheduled messages start with `good morning, this is lunch today:` or `good afternoon, this is dinner today:`. Menu card footers read `a bot by hydrogen_01`.

## Entrée ratings

Each entrée has **Like 👍**, **fine 🤔**, and **Dislike 👎** buttons with historical counts. You can save one rating per dish, menu date, and user. Clicking the same button again withdraws your vote; clicking another changes it. Voting silently updates the clicked message without sending a confirmation to the voter.

Every new menu shows school-wide historical totals across menu dates. Approval is Likes / (Likes + Fine + Dislikes). Ratings are isolated by school. Personal messages label the summary **Personal ratings**, but the totals are still shared within the school, not restricted to your own votes. Loomis has one rating row for the first Grill Main item.

Other messages retain their snapshot until interacted with. `/votes` shows current saved states (including withdrawn votes), not a chronological log of every button click. Its three-day range is based on menu dates, not click timestamps.

## Self-hosting

Requirements: Node.js 22.13+, a Cloudflare account with Workers and D1, and your own Discord application with a bot.

1. Clone this repository and install dependencies:

```sh
git clone https://github.com/A-Very-Long-Name/discord-menu-bot.git
cd discord-menu-bot
npm ci
npm test
npx wrangler login
npx wrangler d1 create sps-menu-bot
```

2. Edit `wrangler.jsonc`: replace `YOUR_D1_DATABASE_ID`, `YOUR_APPLICATION_ID`, and `YOUR_PUBLIC_KEY` with your own values. Application ID and Public Key are on the Discord Developer Portal's General Information page. The Public Key is not the Bot Token.

3. Create the database and deploy:

```sh
npx wrangler d1 execute sps-menu-bot --remote --file=schema.sql
npm run deploy
npx wrangler secret put DISCORD_BOT_TOKEN
```

Enter your Bot Token at the secret prompt. It is needed for messages and command registration. Never commit it to the repository.

4. In the Discord Developer Portal, set **Interactions Endpoint URL** to:

```text
https://sps-menu-bot.<your-workers-subdomain>.workers.dev/interactions
```

5. Register commands:

```sh
cp .env.example .env
```

Fill `.env` locally with your Application ID and Bot Token. `DISCORD_GUILD_ID` is optional; when supplied, registration removes this app's retired guild-specific menu commands from that guild. Then run:

```sh
npm run register
```

Registration enables user and server installation and creates global `/setup`, `/food`, and `/votes` commands. Use your own application's install link for a self-hosted instance, replacing the hosted app's client ID with yours. Enable User Install and Guild Install in the Developer Portal if necessary. No privileged Message Content, Presence, or Server Members intents are needed.

6. Install your app, run `/setup`, and try `/food`. Discord may need a refresh before updated global command choices appear.

The one-minute Cloudflare Cron trigger is already configured. Fresh deployments use `schema.sql`; legacy SPS installations may apply the relevant migration files once after backing up their database (school migration does not seed a server binding; configure it with `/setup`). This repository does not include the hosted instance's local credentials, database exports, or deployment history.

## Testing and limitations

`npm test` runs offline parser, scheduling, setup, signature, and voting tests without posting Discord messages. `npx wrangler deploy --dry-run` checks the Worker build.

School endpoints and page layouts can change. Missing or unpublished menus are reported rather than replaced with a different date. Reminder failures are retried within a bounded delivery window; Cloudflare scheduling is not guaranteed to run at the exact second. D1 delivery records and Discord nonces reduce duplicates, but delivery across services cannot guarantee exactly-once behavior in every failure scenario.

The bot may appear offline because it uses HTTP interactions instead of a Gateway presence connection. Commands and reminders can still work.

Stored data includes Discord user IDs, school bindings, reminder channel IDs and times, dish names, vote states, and delivery records. `/votes` privately reveals voters' identities and saved states to any user who invokes it for that school. Keep this behavior in mind when using the hosted app or running your own instance.

This is an independent community project and is not affiliated with the schools, dining providers, Discord, or Cloudflare.
