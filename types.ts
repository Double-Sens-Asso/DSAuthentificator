export interface NocoMember {
  recordId: number;
  email: string;
  discordId: string | null;
  cotisationValide: boolean;
}

export interface VerificationResult {
  valid: boolean;
  message: string;
  member?: NocoMember;
}