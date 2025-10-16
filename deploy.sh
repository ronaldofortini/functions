#!/bin/bash

# Este comando garante que o script pare imediatamente se algum comando falhar.
set -e

# 1. Pega a mensagem de deploy do primeiro argumento passado para o script.
#    Ex: npm run deploy "Minha mensagem" -> $1 será "Minha mensagem"
if [ -z "$1" ]; then
  # Se nenhuma mensagem for fornecida, cria uma mensagem padrão com a data e hora.
  COMMIT_MESSAGE="Deploy automático em $(date +'%Y-%m-%d %H:%M:%S')"
else
  # Usa a mensagem que você forneceu.
  COMMIT_MESSAGE="$1"
fi

echo "🚀 Iniciando processo de deploy..."

# 2. Compila o código TypeScript para JavaScript (etapa de build).
echo "📦 Compilando o código TypeScript..."
npm run build
echo "✅ Código compilado com sucesso."

# 3. Adiciona todos os arquivos modificados ao Git.
echo "🐙 Adicionando arquivos ao Git..."
git add .

# 4. Cria o commit com a mensagem definida no passo 1.
echo "📝 Criando commit com a mensagem: '$COMMIT_MESSAGE'..."
git commit -m "$COMMIT_MESSAGE"

# 5. Envia as alterações para o seu repositório remoto (GitHub).
echo "☁️ Enviando alterações para o GitHub..."
git push

# 6. Faz o deploy apenas das functions para o Firebase.
echo "🔥 Fazendo deploy para o Firebase Functions..."
firebase deploy --only functions

echo "🎉 Deploy concluído com sucesso!"