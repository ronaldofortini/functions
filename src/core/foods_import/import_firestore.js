const admin = require('firebase-admin');
const fs = require('fs');

// --- CONFIGURAÇÃO ---
const NOME_DA_COLECAO = 'foods';
const CAMINHO_CREDENCIAL = './firebase-credentials.json';
// --------------------

// Inicializa o Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(CAMINHO_CREDENCIAL)
});

const db = admin.firestore();

// Pega o nome do arquivo do argumento do terminal
const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: node import_firestore.js <caminho_para_o_arquivo.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

async function importarJson() {
  console.log(`Iniciando importação para a coleção '${NOME_DA_COLECAO}'...`);

  if (Array.isArray(data)) {
    const batch = db.batch();
    data.forEach(item => {
      const docRef = db.collection(NOME_DA_COLECAO).doc(item.id);
      batch.set(docRef, item);
    });
    await batch.commit();
    console.log(`Sucesso! ${data.length} documentos salvos na coleção '${NOME_DA_COLECAO}'.`);
  } else if (typeof data === 'object' && data !== null) {
    await db.collection(NOME_DA_COLECAO).add(data);
    console.log(`Sucesso! 1 documento salvo na coleção '${NOME_DA_COLECAO}'.`);
  } else {
    console.error('Erro: O JSON precisa ser um objeto ou um array de objetos.');
  }
}

importarJson().catch(console.error);