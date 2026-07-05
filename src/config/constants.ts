/**
 * Constantes applicatives pures (sans I/O).
 * Regroupe la validation e-mail, les couleurs d'embed et les identifiants
 * stables des composants d'interaction Discord (boutons / modals).
 */

/** Format e-mail simple (présence d'un @ et d'un point). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Limite RFC 5321 sur la longueur d'une adresse e-mail. */
export const EMAIL_MAX_LENGTH = 254;

/** Couleurs des embeds Discord (logs & feedback utilisateur). */
export const Colors = {
  BRAND: 0x5865F2,
  SUCCESS: 0x00FF00,
  WARNING: 0xFFA500,
  ERROR: 0xFF0000,
  REMINDER: 0xFFFF00,
} as const;

/**
 * Identifiants stables des composants d'interaction.
 * Centralisés ici pour éviter les fautes de frappe entre l'émetteur
 * (bouton/modal) et le routeur qui les dispatche.
 */
export const CustomId = {
  BTN_VERIFY_START: "btn_verify_start",
  BTN_ENTER_CODE: "btn_enter_code",
  MODAL_EMAIL: "modal_email",
  MODAL_CODE: "modal_code",
  INPUT_EMAIL: "input_email",
  INPUT_CODE: "input_code",
  MODAL_AVIS: "modal_avis",
  INPUT_AVIS_NOTE: "input_avis_note",
  INPUT_AVIS_COMMENT: "input_avis_comment",
} as const;
