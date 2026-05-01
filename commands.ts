import { PermissionFlagsBits, SlashCommandBuilder } from "npm:discord.js@14";

export const commands = [
  // Public
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Lancer la procédure de vérification d'adhésion"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifier si le bot répond"),

  new SlashCommandBuilder()
    .setName("mon-statut")
    .setDescription("Voir le statut de ton adhésion (cotisation, retrait éventuel)"),

  // Admin
  new SlashCommandBuilder()
    .setName("admin-unlink")
    .setDescription("👑 Admin: Délier un email d'un compte Discord")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName("email").setDescription("L'email à libérer").setRequired(true)),

  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("👑 Admin: Vérifier le statut d'un email")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName("email").setDescription("L'email à vérifier").setRequired(true)),

  new SlashCommandBuilder()
    .setName("admin-pending")
    .setDescription("👑 Admin: Lister les retraits de rôle en attente")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("admin-cancel-removal")
    .setDescription("👑 Admin: Annuler un retrait de rôle programmé")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) => opt.setName("email").setDescription("L'email concerné").setRequired(true)),
].map((c) => c.toJSON());
