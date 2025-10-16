// const admin = require('firebase-admin');

// // Substitua pelo caminho do seu arquivo de chave de conta de serviço
// const serviceAccount = require('./serviceAccountKey.json');

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

// async function excluirTodosUsuarios(nextPageToken) {
//   try {
//     const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
//     const uidsParaExcluir = listUsersResult.users.map(userRecord => userRecord.uid);

//     if (uidsParaExcluir.length > 0) {
//       const result = await admin.auth().deleteUsers(uidsParaExcluir);
//       console.log(`Successfully deleted ${result.successCount} users`);
//       console.log(`Failed to delete ${result.failureCount} users`);
//       result.errors.forEach((err) => {
//         console.log(err.error.toJSON());
//       });
//     }

//     if (listUsersResult.pageToken) {
//       // Lista e exclui a próxima página de usuários
//       await excluirTodosUsuarios(listUsersResult.pageToken);
//     } else {
//       console.log('Todos os usuários foram processados.');
//     }
//   } catch (error) {
//     console.log('Error listing or deleting users:', error);
//   }
// }

// // Inicia o processo de exclusão
// excluirTodosUsuarios();