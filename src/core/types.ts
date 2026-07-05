/**
 * =============================================================================
 * DÉFINITIONS DE TYPES (MODÈLES DU DOMAINE)
 * =============================================================================
 * Ce fichier sert de "contrat" pour les données circulant dans l'application.
 * Il permet à TypeScript de vérifier que nous n'essayons pas d'accéder à des
 * propriétés inexistantes et facilite l'autocomplétion dans l'IDE.
 */

/**
 * Représentation interne d'un Adhérent (nettoyée et normalisée).
 *
 * Cette interface est découplée de la structure brute de la base de données
 * (NocoDB). Si la structure de la BDD change, seul le mappage dans
 * `infrastructure/nocodb/members.repo.ts` doit être mis à jour ; le reste de
 * l'application continue d'utiliser cette interface stable.
 */
export interface NocoMember {
  /** L'identifiant unique de la ligne dans NocoDB (Primary Key) */
  recordId: number;

  /** Email normalisé (minuscules, sans espaces) */
  email: string;

  /**
   * ID Discord (Snowflake) associé.
   * Peut être `null` si l'utilisateur n'a pas encore lié son compte.
   */
  discordId: string | null;

  /**
   * Booléen calculé indiquant si l'adhérent est à jour de sa cotisation.
   * Simplifie la logique métier en évitant de vérifier des dates ou des
   * statuts complexes ailleurs.
   */
  cotisationValide: boolean;
}

/**
 * Objet de retour standardisé pour les fonctions de vérification (Service Pattern).
 * Renvoie de façon structurée : un état (succès/échec), une explication pour
 * l'UI, et les données contextuelles.
 */
export interface VerificationResult {
  /** `true` si l'utilisateur peut procéder à l'étape suivante (envoi du code) */
  valid: boolean;

  /** Message destiné à être affiché directement à l'utilisateur final */
  message: string;

  /** Données de l'adhérent, présentes uniquement si l'email a été trouvé. */
  member?: NocoMember;
}
