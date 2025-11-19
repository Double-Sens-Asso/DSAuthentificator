import { SlashCommandBuilder, PermissionFlagsBits } from "npm:discord.js@14";

export const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Lancer la procédure d'adhésion sécurisée"),
  
  new SlashCommandBuilder()
    .setName("admin-unlink")
    .setDescription("👑 Admin: Délier un email manuellement")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("email").setDescription("Email à libérer").setRequired(true)),

  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("👑 Admin: Voir les infos d'un email")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("email").setDescription("Email à vérifier").setRequired(true))
].map(c => c.toJSON());