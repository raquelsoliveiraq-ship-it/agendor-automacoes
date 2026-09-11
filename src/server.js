import app from './app.js';

const PORT = process.env.PORT || 4141;

const server = app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
});

// Mensagem clara quando a porta já está ocupada — em vez do stack trace do
// Node — porque o caso comum é ter um dashboard antigo ainda rodando.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nA porta ${PORT} já está em uso. Provavelmente há outro "npm run dashboard" aberto.\n` +
        `Feche aquele terminal (ou o processo na porta ${PORT}) e rode de novo,\n` +
        `ou mude PORT no arquivo .env para outro número.\n`
    );
    process.exit(1);
  }
  throw err;
});
