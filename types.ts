export interface NocoMember {
  recordId: number;
  email: string;
  discordId: string | null;
  cotisationValide: boolean;
}

export interface VerificationResult {
  success: boolean;
  message: string;
  member?: NocoMember;
}

export interface ConfigEnv {
  TOKEN: string;
  GUILD_ID: string;
  VERIFY_ROLE_ID: string;
  LOG_CHANNEL_ID: string;
  NOCODB_BASE_URL: string;
  NOCODB_TOKEN: string;
  NOCODB_PROJECT_ID: string;
  NOCODB_TABLE_ID: string;
  COL_EMAIL: string;
  COL_DISCORD_ID: string;
  COL_COTISATION: string;
}