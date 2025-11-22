
import { SlashCommandBuilder, PermissionFlagsBits } from "npm:discord.js@14";

export const commands = [

  // Public
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Lancer la procédure de vérification d'adhésion"),


  


  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Vérifier si le bot répond"),


  


  // Admin


  new SlashCommandBuilder()

    .setName("admin-unlink")
    .setDescription("👑 Admin: Délier un email d'un compte Discord")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt => 
      opt.setName("email").setDescription("L'email à libérer").setRequired(true)
    ),


    
  new SlashCommandBuilder()
    .setName("admin-check")
    .setDescription("👑 Admin: Vérifier le statut d'un email")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt => 
      opt.setName("email").setDescription("L'email à vérifier").setRequired(true)
    )

].map(c => c.toJSON());