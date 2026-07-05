// deno-lint-ignore-file no-import-prefix
import { Client, GatewayIntentBits } from "npm:discord.js@14";

/** Crée le client Discord avec les intents strictement nécessaires. */
export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
}
