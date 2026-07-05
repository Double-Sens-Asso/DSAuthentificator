FROM denoland/deno:alpine

WORKDIR /app

# Copie les fichiers de deps d'abord pour profiter du cache Docker
COPY deno.json package-lock.json* ./

# Copie le reste du code
COPY . .

# Cache les dépendances (build time, pas runtime)
RUN deno cache src/main.ts

# Lance le bot avec les permissions nécessaires
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "src/main.ts"]