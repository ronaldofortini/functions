#!/bin/bash

set -e

# 1. Pega a mensagem de commit do primeiro argumento.
if [ -z "$1" ]; then
  echo "🛑 Erro: Por favor, forneça uma mensagem de commit."
  exit 1
fi

# 2. Pega a lista de funções do segundo argumento.
if [ -z "$2" ]; then
  echo "🛑 Erro: Por favor, forneça os nomes das funções para o deploy."
  echo "   Exemplo: \"handleAuthStep,finalizeRegistration\""
  exit 1
fi

COMMIT_MESSAGE="$1"
FUNCTION_NAMES="$2"

# Mapeia a string de nomes para o formato que o Firebase CLI precisa
FIREBASE_FUNCTION_TARGETS=$(echo "$FUNCTION_NAMES" | sed 's/,/,functions:/g' | sed 's/^/functions:/')

echo "🚀 Iniciando processo de deploy focado..."
echo "🎯 Funções alvo: $FUNCTION_NAMES"

# 3. Compila o código TypeScript.
echo "📦 Compilando o código TypeScript..."
npm run build
echo "✅ Código compilado com sucesso."

# 4. Salva no Git (opcional, mas boa prática).
echo "🐙 Adicionando arquivos ao Git..."
git add .
echo "📝 Criando commit: '$COMMIT_MESSAGE'..."
git commit -m "$COMMIT_MESSAGE"
echo "☁️ Enviando para o GitHub..."
git push

# 5. Faz o deploy APENAS das functions especificadas.
echo "🔥 Fazendo deploy para o Firebase Functions..."
firebase deploy --only "$FIREBASE_FUNCTION_TARGETS"

echo "🎉 Deploy focado concluído com sucesso!"