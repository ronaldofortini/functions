#!/bin/bash

# Este comando garante que o script pare imediatamente se algum comando falhar.
set -e

# 1. Pega a mensagem de commit do primeiro argumento.
if [ -z "$1" ]; then
  echo "🛑 Erro: Por favor, forneça uma mensagem de commit."
  echo "   Exemplo: npm run save \"Corrigido bug X\""
  exit 1
fi

COMMIT_MESSAGE="$1"

echo "🚀 Iniciando salvamento no repositório..."

# 2. Adiciona todos os arquivos modificados ao Git.
echo "🐙 Adicionando arquivos ao Git..."
git add .

# 3. Cria o commit com a sua mensagem.
echo "📝 Criando commit com a mensagem: '$COMMIT_MESSAGE'..."
git commit -m "$COMMIT_MESSAGE"

# 4. Envia as alterações para o seu repositório remoto (GitHub).
echo "☁️ Enviando alterações para o GitHub..."
git push

echo "✅ Código salvo com sucesso no GitHub!"